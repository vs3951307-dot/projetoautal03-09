/**
 * Interpretação determinística de sabores e meio a meio.
 *
 * O cliente escreve "pizza calabresa metade strogonofe" numa mensagem só.
 * Antes, esse texto era jogado inteiro no `buscarProdutos` (não achava
 * nada) ou reescrito pelo LLM (que escolhia a variante sozinho).
 *
 * Aqui o texto é quebrado em segmentos e cada segmento é resolvido pelo
 * `resolver.ts` contra os sabores REAIS daquele produto. O que sai é um
 * retrato honesto: o que ficou resolvido, o que ficou ambíguo e o que
 * não existe. Quem decide o que fazer com isso é o motor.
 */

import { resolver, normalizar } from "@/lib/atendente/resolver";

export interface SaborCatalogo {
  nome: string;
  tipo?: string;
}

export interface Ambiguidade {
  /** Trecho que o cliente escreveu. */
  termo: string;
  /** Nomes reais do catálogo entre os quais é preciso escolher. */
  candidatos: string[];
}

export interface LeituraSabores {
  /** O cliente sinalizou meio a meio / fracionamento. */
  meioAMeio: boolean;
  /** Quantidade de sabores pedida, quando dá para inferir com segurança. */
  quantidade?: number;
  /** Sabores resolvidos, na ordem em que apareceram, sem repetição. */
  resolvidos: string[];
  /** Trechos que casaram com mais de um sabor: PRECISAM de pergunta. */
  ambiguos: Ambiguidade[];
  /** Trechos que não casaram com nada do catálogo. */
  desconhecidos: string[];
}

/** Marcadores de fracionamento. Só de contexto — não são sabores. */
const MARCADOR_FRACAO =
  /\b(metade|metd|meia|meio\s*a\s*meio|meio|1\s*\/\s*2|1\/2|half)\b/gi;

/** Separadores de sabores dentro da mesma mensagem. */
const SEPARADORES =
  /\b(metade|metd|meia|meio\s*a\s*meio|meio|1\s*\/\s*2|1\/2|e|mais|com)\b|[,;+/]/gi;

/** Palavras de categoria/quantidade que nunca são sabor. */
const RUIDO = new Set([
  "pizza", "pizzas", "esfiha", "esfihas", "lanche", "sanduiche",
  "grande", "media", "pequena", "familia", "broto", "gigante", "brotinho",
  "quero", "queria", "gostaria", "uma", "um", "duas", "dois", "por", "favor",
  "sabor", "sabores", "outra", "outro", "primeira", "segunda", "parte",
]);

const NUMEROS: Record<string, number> = {
  "1": 1, um: 1, uma: 1, unico: 1,
  "2": 2, dois: 2, duas: 2,
  "3": 3, tres: 3,
  "4": 4, quatro: 4,
};

function limparSegmento(seg: string): string {
  return normalizar(seg)
    .split(" ")
    .filter((t) => t.length > 0 && !RUIDO.has(t))
    .join(" ")
    .trim();
}

/**
 * Lê a mensagem procurando sabores do produto informado.
 *
 * @param texto  Mensagem original do cliente.
 * @param opcoes Sabores REAIS do produto (vindos do banco).
 */
export function lerSabores(texto: string, opcoes: SaborCatalogo[]): LeituraSabores {
  const resultado: LeituraSabores = {
    meioAMeio: false,
    resolvidos: [],
    ambiguos: [],
    desconhecidos: [],
  };
  if (opcoes.length === 0) return resultado;

  const normalizado = normalizar(texto);
  MARCADOR_FRACAO.lastIndex = 0;
  resultado.meioAMeio = MARCADOR_FRACAO.test(normalizado);

  // "quero 2 sabores" / "três sabores"
  const mQtd = normalizado.match(/\b(\d+|um|uma|dois|duas|tres|quatro)\s+sabor(?:es)?\b/);
  if (mQtd) resultado.quantidade = NUMEROS[mQtd[1]];

  const segmentos = normalizado
    .split(SEPARADORES)
    .map((s) => (s ?? "").trim())
    .filter(Boolean);

  const vistos = new Set<string>();
  for (const bruto of segmentos) {
    const seg = limparSegmento(bruto);
    if (seg.length < 3) continue;
    // O próprio separador reaparece como segmento por causa do grupo de
    // captura no split; descarta.
    if (/^(metade|metd|meia|meio|meio a meio|e|mais|com|1 2|1\/2)$/.test(seg)) continue;

    const r = resolver(seg, opcoes);
    if (r.tipo === "EXACT" || r.tipo === "UNIQUE") {
      const nome = r.escolhido!.nome;
      if (!vistos.has(nome)) {
        vistos.add(nome);
        resultado.resolvidos.push(nome);
      }
    } else if (r.tipo === "MULTIPLE") {
      const candidatos = r.candidatos.map((c) => c.nome);
      const jaTem = resultado.ambiguos.some(
        (a) => a.candidatos.join("|") === candidatos.join("|")
      );
      if (!jaTem) resultado.ambiguos.push({ termo: seg, candidatos });
    } else {
      resultado.desconhecidos.push(seg);
    }
  }

  if (resultado.quantidade === undefined) {
    const citados = resultado.resolvidos.length + resultado.ambiguos.length;
    if (resultado.meioAMeio && citados >= 2) resultado.quantidade = citados;
    else if (resultado.meioAMeio && citados === 1) resultado.quantidade = 2;
    else if (citados >= 2) resultado.quantidade = citados;
  }

  return resultado;
}
