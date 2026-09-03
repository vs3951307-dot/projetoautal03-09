/**
 * Tools de ESCRITA do Copiloto da Empresa (operações do dia a dia por
 * conversa: estoque, disponibilidade de produto).
 *
 * REGRA DE SEGURANÇA CENTRAL (não negociável): toda função aqui recebe
 * `empresaId` como PRIMEIRO parâmetro, e quem chama SEMPRE o obtém de
 * `autorizar()` (sessão autenticada no servidor) — nunca do corpo da
 * requisição, nunca do prompt, nunca de foto/áudio, nunca da resposta
 * da IA. A IA só escolhe QUAL tool e com quais parâmetros de negócio;
 * a qual empresa isso se aplica é decisão exclusiva do servidor.
 *
 * REGRA DE CONFIRMAÇÃO: nenhuma destas funções deve ser chamada
 * diretamente a partir da interpretação da IA. O fluxo é sempre:
 * interpretar → montar PRÉVIA estruturada → usuário confirma → só
 * então executar (ver `src/lib/copiloto/acoes.ts`).
 *
 * Toda alteração registra auditoria (quem, quando, valores antes/depois).
 */

import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/acesso";
import type { UsuarioComPermissoes } from "@/lib/permissao";
import { resolver, perguntarEntre } from "@/lib/atendente/resolver";
import {
  interpretarValidade,
  lerBloqueios,
  registrarBloqueio,
  removerBloqueio,
} from "@/lib/atendente/bloqueios";

export interface ResultadoTool {
  ok: boolean;
  mensagem: string;
  detalhes?: Record<string, unknown>;
}

/** Entrada de mercadoria: soma ao estoque e registra a movimentação. `notaId` vincula a entrada à nota fiscal que a originou. */
export async function registrarEntradaEstoque(
  empresaId: string,
  usuario: UsuarioComPermissoes,
  params: { nomeProduto: string; quantidade: number; fornecedor?: string; valorTotal?: number; notaId?: string | null }
): Promise<ResultadoTool> {
  const { nomeProduto, quantidade } = params;
  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    return { ok: false, mensagem: "Quantidade inválida." };
  }

  const item = await prisma.estoqueProduto.findFirst({
    where: { empresaId, nome: { equals: nomeProduto, mode: "insensitive" } },
  });
  if (!item) {
    return {
      ok: false,
      mensagem: `Não encontrei "${nomeProduto}" no estoque desta empresa. Cadastre o item primeiro em Admin → Estoque.`,
    };
  }

  const quantidadeAnterior = item.quantidade;
  const [atualizado] = await prisma.$transaction([
    prisma.estoqueProduto.update({
      where: { id: item.id },
      data: { quantidade: { increment: quantidade } },
    }),
    prisma.movimentacaoEstoque.create({
      data: {
        empresaId,
        produtoId: item.id,
        tipo: "entrada",
        quantidade,
        fornecedor: params.fornecedor,
        valorTotal: params.valorTotal,
        notaId: params.notaId ?? null,
        responsavel: usuario.nome,
      },
    }),
  ]);

  await registrarAuditoria(
    "copiloto_entrada_estoque",
    `${item.nome}: ${quantidadeAnterior} → ${atualizado.quantidade} ${item.unidade} (+${quantidade})`,
    usuario,
    undefined,
    empresaId
  );

  return {
    ok: true,
    mensagem: `Entrada registrada: ${item.nome} passou de ${quantidadeAnterior} para ${atualizado.quantidade} ${item.unidade}.`,
    detalhes: { produto: item.nome, antes: quantidadeAnterior, depois: atualizado.quantidade },
  };
}

/** Define a quantidade exata em estoque (correção/contagem), registrando a diferença como movimentação. */
export async function ajustarQuantidadeEstoque(
  empresaId: string,
  usuario: UsuarioComPermissoes,
  params: { nomeProduto: string; novaQuantidade: number }
): Promise<ResultadoTool> {
  const { nomeProduto, novaQuantidade } = params;
  if (!Number.isFinite(novaQuantidade) || novaQuantidade < 0) {
    return { ok: false, mensagem: "Quantidade inválida." };
  }

  const item = await prisma.estoqueProduto.findFirst({
    where: { empresaId, nome: { equals: nomeProduto, mode: "insensitive" } },
  });
  if (!item) {
    return { ok: false, mensagem: `Não encontrei "${nomeProduto}" no estoque desta empresa.` };
  }

  const diferenca = novaQuantidade - item.quantidade;
  const operacoes: unknown[] = [
    prisma.estoqueProduto.update({ where: { id: item.id }, data: { quantidade: novaQuantidade } }),
  ];
  if (diferenca !== 0) {
    operacoes.push(
      prisma.movimentacaoEstoque.create({
        data: {
          empresaId,
          produtoId: item.id,
          tipo: diferenca > 0 ? "entrada" : "saida",
          quantidade: Math.abs(diferenca),
          responsavel: usuario.nome,
          fornecedor: "Ajuste pelo Copiloto",
        },
      })
    );
  }
  await prisma.$transaction(operacoes as never);

  await registrarAuditoria(
    "copiloto_ajuste_estoque",
    `${item.nome}: ${item.quantidade} → ${novaQuantidade} ${item.unidade}`,
    usuario,
    undefined,
    empresaId
  );

  return {
    ok: true,
    mensagem: `${item.nome} agora está com ${novaQuantidade} ${item.unidade} (antes: ${item.quantidade}).`,
    detalhes: { produto: item.nome, antes: item.quantidade, depois: novaQuantidade },
  };
}

/** Marca um produto do cardápio como indisponível/disponível (ex.: "acabou calabresa"). */
export async function definirDisponibilidadeProduto(
  empresaId: string,
  usuario: UsuarioComPermissoes,
  params: {
    nomeProduto: string;
    disponivel: boolean;
    /**
     * Frase original do operador. E dela que sai a TEMPORALIDADE:
     * "hoje" -> fim do dia operacional, "por 2 horas" -> +2h,
     * "ate eu avisar" -> sem expiracao. Ver `bloqueios.ts`.
     */
    validadeTexto?: string;
  }
): Promise<ResultadoTool> {
  const { nomeProduto, disponivel } = params;

  // AMBIGUIDADE (era `findFirst`): "acabou estrogonofe" batia em
  // "Estrogonofe de Carne" E "Estrogonofe de Frango", e o `findFirst`
  // desativava silenciosamente o primeiro que o banco devolvesse. Agora
  // o empate NAO altera nada: devolve a pergunta para o operador.
  const candidatosProduto = await prisma.produto.findMany({
    where: { empresaId, nome: { contains: nomeProduto, mode: "insensitive" } },
    take: 25,
    select: { id: true, nome: true },
  });
  const candidatosSabor = await prisma.sabor.findMany({
    where: { empresaId, nome: { contains: nomeProduto, mode: "insensitive" } },
    take: 25,
    select: { id: true, nome: true },
  });
  const universo = [
    ...candidatosProduto.map((c: { id: string; nome: string }) => ({ nome: c.nome, tipo: "produto" as const, id: c.id })),
    ...candidatosSabor.map((c: { id: string; nome: string }) => ({ nome: c.nome, tipo: "sabor" as const, id: c.id })),
  ];
  const alvo = resolver(nomeProduto, universo);
  if (alvo.tipo === "MULTIPLE") {
    return {
      ok: false,
      mensagem: `Encontrei mais de um item com "${nomeProduto}". Você quer ${
        disponivel ? "liberar" : "indisponibilizar"
      } ${perguntarEntre(alvo.candidatos.map((c) => c.nome))}, ou todos?`,
      detalhes: { ambiguo: true, candidatos: alvo.candidatos.map((c) => c.nome) },
    };
  }
  if (alvo.tipo === "NONE") {
    return {
      ok: false,
      mensagem: `Não encontrei nenhum produto ou sabor chamado "${nomeProduto}" nesta empresa.`,
    };
  }
  const escolhido = alvo.escolhido!;

  const produto =
    escolhido.tipo === "produto"
      ? await prisma.produto.findFirst({ where: { id: escolhido.id, empresaId } })
      : null;
  if (produto) {
    return aplicarDisponibilidade(empresaId, usuario, {
      tipo: "produto",
      id: produto.id,
      nome: produto.nome,
      ativoNoCadastro: produto.ativo,
      disponivel,
      validadeTexto: params.validadeTexto ?? nomeProduto,
    });
  }

  // Não é produto do cardápio — pode ser um SABOR (ex.: "calabresa").
  const sabor =
    escolhido.tipo === "sabor"
      ? await prisma.sabor.findFirst({ where: { id: escolhido.id, empresaId } })
      : null;
  if (sabor) {
    return aplicarDisponibilidade(empresaId, usuario, {
      tipo: "sabor",
      id: sabor.id,
      nome: sabor.nome,
      ativoNoCadastro: sabor.ativo,
      disponivel,
      validadeTexto: params.validadeTexto ?? nomeProduto,
    });
  }

  return {
    ok: false,
    mensagem: `Não encontrei nenhum produto ou sabor chamado "${nomeProduto}" nesta empresa.`,
  };
}

/**
 * Aplica a mudanca de disponibilidade como BLOQUEIO OPERACIONAL, nao como
 * alteracao de cadastro.
 *
 * Antes, "hoje nao temos X" escrevia `ativo = false` no proprio produto —
 * permanente, sem data de volta, no mesmo campo que o cardapio usa. Agora
 * a informacao operacional vive em `Configuracao` com validade propria
 * (ver `src/lib/atendente/bloqueios.ts`) e o CADASTRO nunca e tocado ao
 * indisponibilizar.
 *
 * Ao LIBERAR ("voltou"), alem de remover o bloqueio, o cadastro e
 * reativado se estiver inativo — isso conserta os itens que ficaram
 * `ativo = false` pelo comportamento antigo.
 */
async function aplicarDisponibilidade(
  empresaId: string,
  usuario: UsuarioComPermissoes,
  alvo: {
    tipo: "produto" | "sabor";
    id: string;
    nome: string;
    ativoNoCadastro: boolean;
    disponivel: boolean;
    validadeTexto: string;
  }
): Promise<ResultadoTool> {
  const { tipo, id, nome, ativoNoCadastro, disponivel, validadeTexto } = alvo;
  const bloqueiosAtuais = await lerBloqueios(empresaId);
  const bloqueado = bloqueiosAtuais.some((b) => b.tipo === tipo && b.id === id);

  if (disponivel) {
    const removido = await removerBloqueio(empresaId, tipo, id);
    let reativadoNoCadastro = false;
    if (!ativoNoCadastro) {
      if (tipo === "produto") {
        await prisma.produto.update({ where: { id }, data: { ativo: true } });
      } else {
        await prisma.sabor.update({ where: { id }, data: { ativo: true } });
      }
      reativadoNoCadastro = true;
    }
    if (!removido && !reativadoNoCadastro) {
      return { ok: true, mensagem: `${nome} já está disponível — nada mudou.` };
    }
    await registrarAuditoria(
      `copiloto_disponibilidade_${tipo}`,
      `${nome}: indisponível → disponível (bloqueio removido${reativadoNoCadastro ? " + cadastro reativado" : ""})`,
      usuario,
      undefined,
      empresaId
    );
    return {
      ok: true,
      mensagem: `${nome} voltou a ficar disponível.`,
      detalhes: { tipo, nome, disponivel: true },
    };
  }

  const validade = interpretarValidade(validadeTexto);
  if (bloqueado) {
    const igual = bloqueiosAtuais.find((b) => b.tipo === tipo && b.id === id);
    const mesmaValidade =
      (igual?.validoAte ?? null) === (validade.validoAte?.toISOString() ?? null);
    if (mesmaValidade) {
      return { ok: true, mensagem: `${nome} já está indisponível ${validade.rotulo} — nada mudou.` };
    }
  }
  await registrarBloqueio(empresaId, {
    tipo,
    id,
    nome,
    validoAte: validade.validoAte ? validade.validoAte.toISOString() : null,
    usuarioId: usuario.id,
    usuarioNome: (usuario as { nome?: string }).nome,
  });
  await registrarAuditoria(
    `copiloto_disponibilidade_${tipo}`,
    `${nome}: indisponível ${validade.rotulo} (bloqueio operacional; cadastro intacto)`,
    usuario,
    undefined,
    empresaId
  );
  return {
    ok: true,
    mensagem: `${nome} está indisponível ${validade.rotulo}.`,
    detalhes: { tipo, nome, disponivel: false, validoAte: validade.validoAte?.toISOString() ?? null },
  };
}

/** Lista os produtos/sabores atualmente indisponíveis (leitura — não altera nada). */
export async function listarIndisponiveis(empresaId: string): Promise<ResultadoTool> {
  const [produtos, sabores] = await Promise.all([
    prisma.produto.findMany({ where: { empresaId, ativo: false }, select: { nome: true } }),
    prisma.sabor.findMany({ where: { empresaId, ativo: false }, select: { nome: true } }),
  ]);

  // Alem dos itens desativados no CADASTRO, entram os bloqueios
  // operacionais temporarios ("hoje nao temos"), que nao mexem em `ativo`.
  const bloqueios = await lerBloqueios(empresaId);
  const rotuloValidade = (validoAte: string | null) =>
    validoAte
      ? ` (até ${new Date(validoAte).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })})`
      : " (até você avisar)";
  const nomesProduto = [
    ...produtos.map((p: { nome: string }) => p.nome),
    ...bloqueios.filter((b) => b.tipo === "produto").map((b) => `${b.nome}${rotuloValidade(b.validoAte)}`),
  ];
  const nomesSabor = [
    ...sabores.map((s: { nome: string }) => s.nome),
    ...bloqueios.filter((b) => b.tipo === "sabor").map((b) => `${b.nome}${rotuloValidade(b.validoAte)}`),
  ];

  if (nomesProduto.length === 0 && nomesSabor.length === 0) {
    return { ok: true, mensagem: "Nenhum produto ou sabor está indisponível no momento." };
  }
  const partes: string[] = [];
  if (nomesProduto.length > 0) partes.push(`Produtos: ${nomesProduto.join(", ")}`);
  if (nomesSabor.length > 0) partes.push(`Sabores: ${nomesSabor.join(", ")}`);
  return { ok: true, mensagem: partes.join(" · "), detalhes: { produtos, sabores, bloqueios } };
}
