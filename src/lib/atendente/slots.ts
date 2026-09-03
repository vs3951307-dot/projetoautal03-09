/**
 * Camada de SLOTS sobre a FSM.
 *
 * CAUSA RAIZ que isto ataca: a FSM do `motor.ts` só aceita a resposta da
 * pergunta atual. Quem está na etapa "tamanho" e diz "não, troca frango
 * por estrogonofe" ouve de volta "Pode confirmar o tamanho?". Quem
 * pergunta "quanto demora?" no meio do pedido é ignorado. Isso não é um
 * caso de borda: é como as pessoas escrevem no WhatsApp.
 *
 * A correção definitiva seria a etapa deixar de ser um cursor. Isso exige
 * reescrever o coração do motor. Esta camada é o caminho intermediário
 * honesto: ANTES de a FSM tratar a mensagem, olhamos se ela é
 *
 *   1. uma CORREÇÃO de algo já preenchido (tamanho, sabor, canal,
 *      pagamento, item do carrinho);
 *   2. uma PERGUNTA avulsa no meio do pedido;
 *   3. informação de OUTRO slot que não o perguntado (o cliente disse
 *      "vou retirar e pago no pix" enquanto o bot perguntava o tamanho).
 *
 * Se for, aplicamos no estado e devolvemos a resposta certa — sem apagar
 * o rascunho e sem reiniciar a conversa. Se não for, a FSM segue como
 * sempre. Nada aqui inventa produto, preço ou disponibilidade: tudo passa
 * pelo resolvedor contra o catálogo real.
 */

import { resolver, perguntarEntre, normalizar } from "@/lib/atendente/resolver";
import { lerSabores } from "@/lib/atendente/sabores";

export interface TamanhoSlot {
  nome: string;
  valor: number;
}
export interface SaborSlot {
  nome: string;
  tipo: string;
}

/** Recorte do estado do motor que esta camada precisa enxergar. */
export interface EstadoSlots {
  atual?: {
    nome: string;
    temTamanhos: boolean;
    temSabores: boolean;
    tamanhos: TamanhoSlot[];
    sabores: SaborSlot[];
    tamanho?: TamanhoSlot;
    saboresEscolhidos: string[];
    saboresFaltando?: number;
    quantidade?: number;
  };
  itens: { nome: string }[];
  canal?: "entrega" | "retirada";
  formaPagamento?: string;
  ambiguidade?: { campo: "sabor" | "produto"; termo: string; candidatos: string[] };
}

/** Marcadores de que o cliente está CORRIGINDO, não respondendo. */
const MARCADOR_CORRECAO =
  /\b(nao|não|n[aã]o e|na verdade|quis dizer|melhor|troca|trocar|muda|mudar|prefiro|corrige|corrigir|esquece|em vez de|no lugar de|ao inv[eé]s)\b/i;

/** Perguntas avulsas que podem aparecer no meio do pedido. */
export type PerguntaAvulsa = "horario" | "entrega" | "prazo" | "cardapio" | "total";

const PERGUNTAS: [PerguntaAvulsa, RegExp][] = [
  ["prazo", /\b(quanto (tempo|demora)|demora|em quanto tempo|qual o prazo|leva quanto)\b/i],
  ["horario", /\b(que horas?|hor[aá]rio|at[eé] que horas|abre|fecha|funciona at[eé]|t[aá] (aberto|funcionando|fazendo)|ainda (t[aá]|t[aã]o?)|t[aã]o? fazendo|vai at[eé] (que horas|quando))\b/i],
  ["entrega", /\b(?:taxa\s+(?:de|da)\s+entrega|voc[eê]s\s+entregam|entregam\s+(?:isso|a[ií]|no\s+meu|em\s+outra|pra\s+outro)|faz(?:em)?\s+entrega|quanto\s+(?:custa|é|fica)\s+a?\s*entrega|entrega\s+fora|n[aã]o\s+entregam|aceitam\s+entrega|custa\s+a\s+entrega)\b/i],
  ["total", /\b(quanto (ficou|fica|deu|t[aá]|custa o pedido)|qual o total|total do pedido|quanto q fica)\b/i],
  ["cardapio", /\b(card[aá]pio|menu|o que (voc[eê]s )?t[eê]m|quais sabores|quais op[cç][õo]es)\b/i],
];

/**
 * Detecta pergunta avulsa. Só vale quando JÁ existe um pedido em
 * andamento — senão a FSM normal já sabe responder e não há o que
 * "retomar" depois.
 */
export function perguntaNoMeio(texto: string, estado: EstadoSlots): PerguntaAvulsa | null {
  const temRascunho = Boolean(estado.atual) || estado.itens.length > 0;
  if (!temRascunho) return null;
  for (const [tipo, re] of PERGUNTAS) {
    if (re.test(texto)) return tipo;
  }
  return null;
}

/* ------------------------------- Canal ------------------------------------ */

const RE_RETIRADA = /\b(vou (buscar|busca|retirar|pegar|passar)|retirada|retirar|pego no local|balc[aã]o|na loja)\b/i;
const RE_ENTREGA = /\b(entrega|delivery|manda (aqui|em casa|pra)|entregar|traz aqui|em casa)\b/i;

export function extrairCanal(texto: string): "entrega" | "retirada" | null {
  if (RE_RETIRADA.test(texto)) return "retirada";
  if (RE_ENTREGA.test(texto)) return "entrega";
  return null;
}

/* ----------------------------- Pagamento ---------------------------------- */

/**
 * Só reconhece a forma quando ela está REALMENTE habilitada no tenant —
 * a lista vem do banco, nunca de uma constante aqui.
 */
export function extrairPagamento(
  texto: string,
  formas: { value: string; label: string }[]
): string | null {
  const t = normalizar(texto);
  // Exige um verbo/preposição de pagamento junto para não confundir
  // "cartão de visitas" ou um sabor chamado "Dinheiro" com a forma.
  if (!/\b(pag(ar|o|amento)|no|na|em|vai ser|ser[aá]|fica)\b/.test(t) && !/^\s*(pix|dinheiro|credito|debito|cartao)\s*$/.test(t)) {
    if (!/\bpix\b/.test(t)) return null;
  }
  for (const f of formas) {
    if (t.includes(normalizar(f.value)) || t.includes(normalizar(f.label))) return f.value;
  }
  const apelidos: [RegExp, string][] = [
    [/\bpix\b/, "pix"],
    [/\bdinheiro|especie|cash\b/, "dinheiro"],
    [/\bdebito\b/, "debito"],
    [/\bcredito\b/, "credito"],
  ];
  for (const [re, valor] of apelidos) {
    if (re.test(t) && formas.some((f) => f.value === valor)) return valor;
  }
  return null;
}

/* ------------------------------ Correções --------------------------------- */

export interface Correcao {
  tipo: "tamanho" | "sabor" | "nenhuma";
  /** Tamanho novo, quando `tipo === "tamanho"`. */
  tamanho?: TamanhoSlot;
  /** Sabor que sai (quando identificado) e sabor que entra. */
  saborAntigo?: string;
  saborNovo?: string;
  /** Candidatos, quando o sabor novo ficou ambíguo. */
  ambiguos?: string[];
}

/**
 * Interpreta uma correção sobre o item em montagem.
 *
 * Exige marcador explícito de correção. Sem isso, "grande" na etapa de
 * sabores continua sendo tratado pela FSM — não queremos que qualquer
 * palavra solta reescreva o rascunho.
 */
export function interpretarCorrecao(texto: string, estado: EstadoSlots): Correcao {
  const atual = estado.atual;
  if (!atual) return { tipo: "nenhuma" };
  if (!MARCADOR_CORRECAO.test(texto)) return { tipo: "nenhuma" };

  // "troca X por Y" / "X no lugar de Y" — a forma mais explícita.
  const troca = texto.match(
    /\btroca(?:r)?\s+(?:o\s+|a\s+|para\s+)?(.{2,30}?)\s+(?:por|pra|para)\s+(.{2,30})$/i
  );
  if (troca && atual.temSabores) {
    const sai = resolver(troca[1], atual.sabores);
    const entra = resolver(troca[2], atual.sabores);
    if (entra.tipo === "MULTIPLE") {
      return {
        tipo: "sabor",
        saborAntigo: sai.escolhido?.nome,
        ambiguos: entra.candidatos.map((c) => c.nome),
      };
    }
    if (entra.tipo === "EXACT" || entra.tipo === "UNIQUE") {
      return { tipo: "sabor", saborAntigo: sai.escolhido?.nome, saborNovo: entra.escolhido!.nome };
    }
  }

  // Correção de tamanho: "na verdade grande", "quis dizer média".
  if (atual.temTamanhos && atual.tamanho) {
    const r = resolver(texto, atual.tamanhos);
    if ((r.tipo === "EXACT" || r.tipo === "UNIQUE") && r.escolhido!.nome !== atual.tamanho.nome) {
      return { tipo: "tamanho", tamanho: r.escolhido as TamanhoSlot };
    }
  }

  // Correção de sabor sem "troca ... por ...": "não, estrogonofe".
  if (atual.temSabores && atual.saboresEscolhidos.length > 0) {
    const leitura = lerSabores(texto, atual.sabores);
    if (leitura.ambiguos.length > 0) {
      return { tipo: "sabor", ambiguos: leitura.ambiguos[0].candidatos };
    }
    const novo = leitura.resolvidos.find((n) => !atual.saboresEscolhidos.includes(n));
    if (novo) return { tipo: "sabor", saborNovo: novo };
  }

  return { tipo: "nenhuma" };
}

/**
 * Aplica a troca de sabor no rascunho.
 *
 * Sem `saborAntigo`, substitui o ÚLTIMO escolhido — é o que o cliente
 * quer dizer com "não, troca por estrogonofe" logo depois de ter falado
 * o segundo sabor. Nunca duplica: se o sabor novo já está no item, só
 * remove o antigo.
 */
export function aplicarTrocaDeSabor(
  atual: NonNullable<EstadoSlots["atual"]>,
  saborNovo: string,
  saborAntigo?: string
): void {
  const escolhidos = atual.saboresEscolhidos;
  const indice = saborAntigo ? escolhidos.indexOf(saborAntigo) : escolhidos.length - 1;
  if (indice >= 0) {
    if (escolhidos.includes(saborNovo)) escolhidos.splice(indice, 1);
    else escolhidos[indice] = saborNovo;
  } else if (!escolhidos.includes(saborNovo)) {
    escolhidos.push(saborNovo);
  }
}

/** Frase de confirmação da troca, para o cliente ver o que foi entendido. */
export function textoDaTroca(atual: NonNullable<EstadoSlots["atual"]>): string {
  return atual.saboresEscolhidos.length > 0
    ? `Trocado! Ficou: *${atual.saboresEscolhidos.join(" + ")}*.`
    : "Anotado!";
}

export function textoAmbiguidade(candidatos: string[]): string {
  return `Você prefere ${perguntarEntre(candidatos)}?`;
}
