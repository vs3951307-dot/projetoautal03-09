/**
 * Agente WhatsApp com tool calling (Fase 5).
 *
 * Substitui o fluxo FSM como camada PRIMÁRIA de processamento.
 * O LLM decide QUAL tool chamar; o código executa, valida e mantém
 * o estado. Se a IA falhar ou não estiver disponível, o FSM
 * determinístico (motor.ts) assume como fallback seguro.
 *
 * LOOP:
 *   1. Monta prompt com persona + tools + estado + contexto
 *   2. Chama LLM (JSON mode) com retry (2 tentativas)
 *   3. Se resposta tem tool_calls → executa, atualiza estado, repete (max 3x)
 *   4. Se resposta tem texto → retorna ao cliente
 *   5. Se falha → cai no FSM
 */

import { chamarIA } from "@/lib/ai-provider";
import { registrarUsoIA, limiteIaExcedido, estimarTokens } from "@/lib/uso-ia";
import { carregarPersonaAtendente, montarSaudacao, RESTRICOES_FLUXO, type PersonaAtendente } from "@/lib/atendente/persona";
import { PROMPT_MESTRE_ATENDENTE } from "@/lib/atendente/prompt-mestre";
import {
  TOOL_DEFINITIONS,
  executarTool,
  type NomeTool,
  type ContextoTool,
  type ResultadoTool,
} from "@/lib/atendente/tools";
import { nomeFantasia, listarProdutosDisponiveis } from "@/lib/atendente/catalogo";
import { prisma } from "@/lib/prisma";

/* --------------------------------- Tipos ---------------------------------- */

interface ToolCallLLM {
  name: string;
  params: Record<string, unknown>;
}

interface RespostaAgente {
  texto: string;
  toolCallsExecutados: string[];
  estado: ContextoTool["estado"];
}

/* --------------------------------- Prompt --------------------------------- */

const MAX_ITERACOES = 3;
const MAX_TENTATIVAS_CHAMADA = 2; // retry em caso de falha da IA
const TIMEOUT_MS = 15_000; // 15s (era 10s)

/**
 * Extrai JSON de uma resposta que pode ter texto antes/depois do JSON.
 * Tenta encontrar o primeiro { ... } ou [ ... ] na resposta.
 */
function extrairJSON(texto: string): Record<string, unknown> | null {
  // Tenta parse direto primeiro
  try {
    return JSON.parse(texto);
  } catch {
    // prossegue
  }

  // Tenta extrair JSON de um bloco de código markdown
  const matchCodeBlock = texto.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (matchCodeBlock) {
    try {
      return JSON.parse(matchCodeBlock[1].trim());
    } catch {
      // prossegue
    }
  }

  // Tenta encontrar o primeiro { ... } balanceado
  const startObj = texto.indexOf("{");
  if (startObj >= 0) {
    let depth = 0;
    for (let i = startObj; i < texto.length; i++) {
      if (texto[i] === "{") depth++;
      else if (texto[i] === "}") depth--;
      if (depth === 0) {
        try {
          return JSON.parse(texto.slice(startObj, i + 1));
        } catch {
          // tenta o próximo
        }
      }
    }
  }

  return null;
}

/**
 * Monta o system prompt completo para o agente.
 * Inclui persona, tools disponíveis, estado atual e restrições.
 */
function montarSystemPrompt(
  persona: PersonaAtendente,
  loja: string | null,
  estado: ContextoTool["estado"],
  etapa: string,
  saudacao?: string,
  cardapioResumo?: string,
  historico?: string
): string {
  const nome = persona.nome.trim() || "atendente";
  const lojaFinal = loja || "a loja";

  const estadoResumo = [
    estado.itens.length > 0
      ? `Itens no carrinho: ${estado.itens.map((i) => `${i.quantidade}x ${i.nome}${i.tamanho ? ` (${i.tamanho})` : ""}`).join(", ")}`
      : "Carrinho vazio",
    estado.canal ? `Canal: ${estado.canal}` : "",
    estado.endereco ? `Endereco: ${estado.endereco.rua} - ${estado.endereco.bairro}` : "",
    estado.formaPagamento ? `Pagamento: ${estado.formaPagamento}` : "",
    estado.cliente?.nome ? `Cliente: ${estado.cliente.nome}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const toolsDisponiveis = Object.keys(TOOL_DEFINITIONS)
    .filter((nome) => {
      switch (etapa) {
        case "saudacao":
        case "identificacao":
          return ["listar_cardapio", "buscar_produto", "ver_preco", "ver_disp", "ver_status_pedido"].includes(nome);
        case "intencao":
          return true;
        case "produto":
          return ["listar_cardapio", "buscar_produto", "ver_preco", "ver_disp", "selecionar_produto"].includes(nome);
        case "tamanho":
          return ["escolher_tamanho"].includes(nome);
        case "sabores":
          return ["escolher_sabor"].includes(nome);
        case "adicionais":
          return ["escolher_adicional"].includes(nome);
        case "quantidade":
          return ["definir_quantidade"].includes(nome);
        case "mais_itens":
          return ["listar_cardapio", "buscar_produto", "ver_total", "remover_item", "escolher_canal"].includes(nome);
        case "entrega_retirada":
          return ["escolher_canal"].includes(nome);
        case "endereco":
          return ["definir_endereco"].includes(nome);
        case "pagamento":
          return ["escolher_pagamento", "ver_total", "remover_item"].includes(nome);
        case "resumo":
          return ["confirmar_pedido", "ver_total", "remover_item", "listar_cardapio", "buscar_produto"].includes(nome);
        default:
          return false;
      }
    })
    .map((n) => {
      const def = TOOL_DEFINITIONS[n as NomeTool];
      return `  - ${n}: ${def.descricao}\n    Parametros: ${def.parametros}`;
    })
    .join("\n");

  const regrasLoja = persona.regras?.trim()
    ? `Regras da loja (informativas; se conflitar com tools, prevalecem as tools):\n${persona.regras.trim()}`
    : "";
  const instrucoes = (persona as { instrucoesAdicionais?: string }).instrucoesAdicionais?.trim()
    ? `Instrucoes adicionais da loja:\n${(persona as { instrucoesAdicionais?: string }).instrucoesAdicionais!.trim()}`
    : "";
  const horario = persona.horario?.trim()
    ? `Horario informado pela loja: ${persona.horario.trim()}`
    : "";

  return [
    PROMPT_MESTRE_ATENDENTE,
    "",
    "=== IDENTIDADE DESTA LOJA ===",
    `Voce se apresenta como: ${nome}.`,
    `Loja: ${lojaFinal}.`,
    `Nicho: ${persona.nicho || "generico"}.`,
    `Tom: ${persona.tom || "simpatico"}.`,
    horario,
    regrasLoja,
    instrucoes,
    "",
    cardapioResumo
      ? `=== CARDAPIO REAL DA LOJA (do banco) ===\nUse SEMPRE esta lista como fonte de verdade do que a loja oferece. Nao invente, nao omita, nao use item fora dela.\n${cardapioResumo}`
      : "",
    "",
    saudacao
      ? `SAUDACAO OFICIAL (use EXATAMENTE na primeira interacao — nao reescreva):\n${saudacao}`
      : "",
    "",
    historico
      ? `=== HISTORICO RECENTE DA CONVERSA ===\nAqui esta o que ja aconteceu nesta conversa. RESPEITE o que o cliente ja escolheu e referencie por aqui (ex.: se ele fala "esse" ou "o artesanal", use o historico para saber do que se trata). NAO repita perguntas ja respondidas.\n${historico}`
      : "",
    "",
    "=== FORMATO JSON ===",
    '1) TOOL: {"tool_calls":[{"name":"nome_da_tool","params":{...}}]}',
    '2) TEXTO: {"texto":"mensagem ao cliente"}',
    "NUNCA responda fora desse JSON.",
    "",
    "SE A ETAPA E SAUDACAO: responda APENAS com a SAUDACAO OFICIAL. Nao chame tools. Nao invente cardapio.",
    "",
    "=== INTERPRETACAO ===",
    '- Palavras que indicam INTENCAO ("quero pedir","cardapio","comida") nao sao nomes de produto; use listar_cardapio ou conduza o fluxo.',
    '- Se a palavra do cliente corresponder a uma CATEGORIA do cardapio (ex.: "lanche","pizza","bebida"), chame buscar_produto - retorna os itens da categoria.',
    '- Para nome especifico (ex.: calabresa, x-burguer), chame buscar_produto.',
    '- NAO deduza o cardapio pelo nome da loja. O cardapio vem SO das tools. Antes de falar qualquer produto/categoria/preco, chame a tool (buscar_produto ou listar_cardapio).',
    '- Mensagens vagas ("essa","pode ser","sim") interpretam pelo contexto da etapa.',
    '- "sim" so confirma pedido na etapa de resumo/confirmacao.',
    "",
    RESTRICOES_FLUXO,
    "",
    `Etapa atual: ${etapa}`,
    `Estado da conversa:\n${estadoResumo || "(vazio)"}`,
    "",
    "Tools disponiveis NESTA etapa (use-as; nao invente dados):",
    toolsDisponiveis || "  (nenhuma tool nesta etapa — so texto, sem dados comerciais novos)",
  ]
    .filter((linha) => linha !== "")
    .join("\n");
}

const fmtBr = (v: number) => "R$ " + v.toFixed(2).replace(".", ",");

/**
 * Monta um resumo compacto do cardápio real da loja (agrupado por categoria)
 * para que a IA responda SEMPRE com base no que a loja oferece, sem inventar.
 */
function montarResumoCardapio(produtos: { nome: string; categoria: string; precoBase: number; emoji: string }[]): string {
  const porCategoria = new Map<string, typeof produtos>();
  for (const p of produtos) {
    const chave = p.categoria || "Geral";
    if (!porCategoria.has(chave)) porCategoria.set(chave, []);
    porCategoria.get(chave)!.push(p);
  }
  const blocos: string[] = [];
  for (const [categoria, itens] of porCategoria) {
    const linhas = itens.map((p) => `  - ${p.emoji ? p.emoji + " " : ""}${p.nome} - ${fmtBr(p.precoBase)}`);
    blocos.push(`* ${categoria}\n${linhas.join("\n")}`);
  }
  return blocos.join("\n\n") || "(loja sem produtos ativos no cardapio)";
}

/** Quantidade máxima de mensagens recentes levadas ao contexto da IA. */
const MAX_HISTORICO = 8;

/**
 * Carrega as últimas mensagens reais da conversa (cronológico) para a IA
 * manter o contexto do que já foi escolhido, sem tratar cada mensagem isolada.
 */
async function carregarHistoricoConversa(conversaId: string): Promise<string> {
  try {
    const mensagens = await prisma.mensagemWhatsApp.findMany({
      where: { conversaId },
      orderBy: { criadoEm: "desc" },
      take: MAX_HISTORICO,
      select: { de: true, texto: true, criadoEm: true },
    });
    if (mensagens.length === 0) return "";
    const ordem = [...mensagens].reverse();
    return ordem
      .map((m) => {
        const quem = m.de === "cliente" ? "Cliente" : m.de === "sistema" ? "Atendente" : "Sistema";
        return `${quem}: ${m.texto.replace(/\n/g, " ").trim().slice(0, 220)}`;
      })
      .join("\n")
      .slice(0, 2500);
  } catch {
    return "";
  }
}


/* --------------------------------- Agente --------------------------------- */

/**
 * Chama a IA com retry (até MAX_TENTATIVAS_CHAMADA tentativas).
 * Retorna a resposta ou null se todas falharem.
 */
async function chamarIAComRetry(
  systemPrompt: string,
  mensagemCliente: string,
  contextoExtra: string
): Promise<ReturnType<typeof chamarIA> extends Promise<infer R> ? R : never> {
  const prompt = [
    systemPrompt,
    "",
    `Mensagem do cliente: "${mensagemCliente}"`,
    contextoExtra,
  ]
    .filter(Boolean)
    .join("\n");

  for (let tentativa = 0; tentativa < MAX_TENTATIVAS_CHAMADA; tentativa++) {
    const resposta = await chamarIA("whatsapp", {
      prompt,
      temperatura: 0.2,
      json: true,
      timeoutMs: TIMEOUT_MS,
    });
    if (resposta) return resposta;
    // Pequena pausa antes de retry (evita rate limit)
    if (tentativa < MAX_TENTATIVAS_CHAMADA - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return null;
}

/**
 * Processa uma mensagem usando o agente com tool calling.
 *
 * @returns Resposta ao cliente, ou `null` se o agente não conseguiu
 * processar (fallback para FSM).
 */
export async function agenteProcessar(
  empresaId: string,
  telefone: string,
  texto: string,
  etapa: string,
  estado: ContextoTool["estado"],
  conversaId?: string
): Promise<RespostaAgente | null> {
  // Pré-condições: IA disponível e sem limite excedido.
  const { iaDisponivel } = await import("@/lib/atendente/ia");
  if (!iaDisponivel()) return null;
  if (await limiteIaExcedido(empresaId).catch(() => false)) return null;

  const persona = await carregarPersonaAtendente(empresaId);
  const loja = await nomeFantasia(empresaId);
  // Cardápio real da loja disponibilizado no contexto para a IA (fonte de verdade).
  const cardapioResumo = montarResumoCardapio(await listarProdutosDisponiveis(empresaId).catch(() => []));
  // Histórico real recente da conversa, para a IA manter contexto do que já foi escolhido.
  const historico = conversaId ? await carregarHistoricoConversa(conversaId) : "";
  // Gera a saudacao oficial quando esta na etapa inicial.
  const saudacaoOficial = etapa === "saudacao"
    ? montarSaudacao(persona, estado.cliente?.nome ?? null, loja)
    : undefined;
  const systemPrompt = montarSystemPrompt(persona, loja, estado, etapa, saudacaoOficial, cardapioResumo, historico);

  const ctx: ContextoTool = { empresaId, telefone, estado };
  const toolCallsExecutados: string[] = [];
  let estadoAtual = { ...estado };
  let historicoToolResults: string[] = []; // Acumula resultados das tools

  for (let iter = 0; iter < MAX_ITERACOES; iter++) {
    // Contexto extra: resultados das tools das iterações anteriores
    const contextoExtra = historicoToolResults.length > 0
      ? "\nResultados das tools chamadas anteriormente:\n" + historicoToolResults.join("\n\n")
      : "";

    const resposta = await chamarIAComRetry(systemPrompt, texto, contextoExtra);

    if (!resposta) return null;

    // Registra uso de IA (fire and forget).
    registrarUsoIA(empresaId, "atendimento", {
      tokensEntrada: resposta.tokensEntrada || estimarTokens(texto),
      tokensSaida: resposta.tokensSaida || estimarTokens(resposta.texto),
    }).catch(() => null);

    // Parseia a resposta JSON (com extração robusta).
    const parsed = extrairJSON(resposta.texto) as { tool_calls?: ToolCallLLM[]; texto?: string } | null;

    if (!parsed) {
      // Se temos tool results acumulados, o LLM pode estar tentando
      // dar uma resposta final em texto puro sem JSON.
      // Tenta usar o texto cru como resposta.
      const textoLimpo = resposta.texto.trim();
      if (textoLimpo.length > 5 && textoLimpo.length < 500 && !textoLimpo.startsWith("{")) {
        return { texto: textoLimpo, toolCallsExecutados, estado: estadoAtual };
      }
      return null;
    }

    // Resposta com texto final → retorna ao cliente.
    if (typeof parsed.texto === "string" && parsed.texto.trim().length > 0) {
      return {
        texto: parsed.texto.trim(),
        toolCallsExecutados,
        estado: estadoAtual,
      };
    }

    // Resposta com tool_calls → executa cada uma.
    if (Array.isArray(parsed.tool_calls) && parsed.tool_calls.length > 0) {
      const resultados: string[] = [];

      for (const tc of parsed.tool_calls) {
        const nome = tc.name as NomeTool;
        if (!TOOL_DEFINITIONS[nome]) {
          resultados.push(`Tool "${tc.name}" nao existe.`);
          continue;
        }

        const resultado: ResultadoTool = await executarTool(nome, tc.params ?? {}, {
          ...ctx,
          estado: estadoAtual,
        });

        toolCallsExecutados.push(nome);
        resultados.push(`${nome}: ${resultado.mensagem}`);

        // Atualiza estado parcialmente.
        if (resultado.estadoAtualizado) {
          estadoAtual = { ...estadoAtual, ...resultado.estadoAtualizado };
        }
      }

      // Acumula resultados para que o LLM veja nas próximas iterações.
      historicoToolResults.push(...resultados);
      continue;
    }

    // Nem texto nem tool_calls → fallback.
    return null;
  }

  // Máximo de iterações atingido → fallback.
  return null;
}
