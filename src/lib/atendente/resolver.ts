/**
 * Resolvedor determinístico de referências ao catálogo.
 *
 * Substitui a "normalização por LLM" (`normalizarComIa`) no ponto em que
 * ela era perigosa: reescrever a mensagem do cliente com nomes do
 * cardápio fazia o MODELO escolher entre variantes ambíguas
 * ("strogonoff" -> "Estrogonofe de Carne") sem autorização do cliente,
 * e o texto reescrito ainda era reaproveitado por outras etapas do FSM.
 *
 * Aqui a escolha é do CÓDIGO e tem quatro resultados possíveis:
 *
 *   EXACT    - o texto bate exatamente com um item (após normalização).
 *   UNIQUE   - um único candidato plausível; pode selecionar.
 *   MULTIPLE - mais de um candidato; NUNCA selecionar, perguntar.
 *   NONE     - nada encontrado; não inventar.
 *
 * Nenhuma regra comercial mora aqui: este módulo só compara strings.
 */

export type TipoResolucao = "EXACT" | "UNIQUE" | "MULTIPLE" | "NONE";

export interface Candidato {
  nome: string;
}

export interface Resolucao<T extends { nome: string }> {
  tipo: TipoResolucao;
  /** Preenchido apenas em EXACT e UNIQUE. */
  escolhido?: T;
  /** Preenchido em MULTIPLE (e em NONE fica vazio). */
  candidatos: T[];
  /** Termo normalizado que foi buscado (útil para log/auditoria). */
  termo: string;
}

/* ----------------------------- Normalização ------------------------------- */

/** Expansões de linguagem informal comuns no WhatsApp brasileiro. */
const EXPANSOES: [RegExp, string][] = [
  [/\b(\d+)\s*litros?\b/g, "$1l"],
  [/\bdois\s*litros?\b/g, "2l"],
  [/\bdoi\s*litros?\b/g, "2l"],
  [/\bum\s*litros?\b/g, "1l"],
  [/\btres\s*litros?\b/g, "3l"],
  [/\b(\d+)\s*ml\b/g, "$1ml"],
  [/\b(\d+)\s*l\b/g, "$1l"],
  [/\brefri\b/g, "refrigerante"],
  [/\bqro\b/g, "quero"],
  [/\bmsm\b/g, "mesma"],
  [/\bmetd\b/g, "metade"],
  [/\bpq\b/g, "porque"],
  [/\bvc\b/g, "voce"],
  [/\btbm\b/g, "tambem"],
];

/**
 * Reduz o texto a uma forma comparável: sem acento, sem pontuação,
 * minúsculo, com abreviações comuns expandidas.
 */
export function normalizar(texto: string): string {
  let t = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [re, sub] of EXPANSOES) t = t.replace(re, sub);
  return t.replace(/\s+/g, " ").trim();
}

/** Palavras que não carregam significado na comparação. */
const VAZIAS = new Set([
  "de", "da", "do", "das", "dos", "e", "com", "sem", "a", "o", "as", "os",
  "um", "uma", "uns", "umas", "no", "na", "em", "por", "pra", "para",
  "quero", "queria", "gostaria", "pedir", "pedido", "por favor", "favor",
  "me", "ve", "manda", "bota", "coloca", "poe", "sabor", "sabores",
]);

/** Singulariza de forma conservadora (só o "s" final de palavras longas). */
function singular(token: string): string {
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

export function tokens(texto: string): string[] {
  return normalizar(texto)
    .split(" ")
    .filter((t) => t.length > 0 && !VAZIAS.has(t))
    .map(singular);
}

/* ------------------------------ Distância --------------------------------- */

/** Levenshtein clássico, com corte por tamanho para não gastar CPU à toa. */
export function distancia(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 4) return 99;
  const linha = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let anterior = linha[0];
    linha[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = linha[j];
      linha[j] = Math.min(
        linha[j] + 1,
        linha[j - 1] + 1,
        anterior + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      anterior = temp;
    }
  }
  return linha[b.length];
}

/**
 * Tolerância de erro de digitação proporcional ao tamanho da palavra.
 * Palavras curtas não toleram erro (senão "carne" viraria "carno"/"caro"
 * e o cliente receberia o produto errado).
 */
function toleranciaDe(token: string): number {
  if (token.length <= 4) return 0;
  if (token.length <= 6) return 1;
  if (token.length <= 9) return 2;
  return 3;
}

/** Um token do cliente "casa" com um token do catálogo? */
function tokenCasa(consulta: string, alvo: string): boolean {
  if (consulta === alvo) return true;
  // Prefixo (abreviação): "cala" -> "calabresa", "estrogo" -> "estrogonofe".
  if (consulta.length >= 4 && alvo.startsWith(consulta)) return true;
  if (alvo.length >= 4 && consulta.startsWith(alvo)) return true;
  const tol = Math.min(toleranciaDe(consulta), toleranciaDe(alvo));
  if (tol === 0) return false;
  return distancia(consulta, alvo) <= tol;
}

/* ------------------------------ Resolução --------------------------------- */

interface Pontuado<T> {
  item: T;
  casados: number;
  exato: boolean;
}

/**
 * Resolve `consulta` contra `opcoes`.
 *
 * Regra central: só devolve EXACT/UNIQUE quando existe UM candidato no
 * melhor nível de evidência. Empate no topo é sempre MULTIPLE — e
 * MULTIPLE significa "pergunte ao cliente", nunca "escolha o primeiro".
 */
export function resolver<T extends { nome: string }>(
  consulta: string,
  opcoes: T[]
): Resolucao<T> {
  const termo = normalizar(consulta);
  const alvos = tokens(consulta);
  if (alvos.length === 0 || opcoes.length === 0) {
    return { tipo: "NONE", candidatos: [], termo };
  }

  // 1) Igualdade exata do texto inteiro.
  const exatos = opcoes.filter((o) => normalizar(o.nome) === termo);
  if (exatos.length === 1) {
    return { tipo: "EXACT", escolhido: exatos[0], candidatos: exatos, termo };
  }
  if (exatos.length > 1) {
    return { tipo: "MULTIPLE", candidatos: exatos, termo };
  }

  // 2) Cobertura de tokens: quantos tokens da consulta aparecem no nome.
  const pontuados: Pontuado<T>[] = [];
  for (const opcao of opcoes) {
    const alvoTokens = tokens(opcao.nome);
    if (alvoTokens.length === 0) continue;
    let casados = 0;
    for (const t of alvos) {
      if (alvoTokens.some((a) => tokenCasa(t, a))) casados++;
    }
    if (casados > 0) {
      pontuados.push({
        item: opcao,
        casados,
        exato: alvoTokens.length === alvos.length && casados === alvos.length,
      });
    }
  }
  if (pontuados.length === 0) {
    return { tipo: "NONE", candidatos: [], termo };
  }

  // 3) Fica só com o melhor nível de evidência.
  const melhor = Math.max(...pontuados.map((p) => p.casados));
  let topo = pontuados.filter((p) => p.casados === melhor);

  // Desempate seguro: correspondência de nome COMPLETO ("calabresa" para
  // "Calabresa") vence correspondência parcial ("calabresa" dentro de
  // "Calabresa Especial") — mas só se houver exatamente uma.
  const completos = topo.filter((p) => p.exato);
  if (completos.length === 1) {
    return { tipo: "UNIQUE", escolhido: completos[0].item, candidatos: [completos[0].item], termo };
  }
  if (completos.length > 1) topo = completos;

  if (topo.length === 1) {
    return { tipo: "UNIQUE", escolhido: topo[0].item, candidatos: [topo[0].item], termo };
  }
  return { tipo: "MULTIPLE", candidatos: topo.map((p) => p.item), termo };
}

/**
 * Frase pronta para pedir desambiguação, no formato "A, B ou C".
 * Fica aqui (e não no prompt do LLM) porque a lista precisa ser
 * exatamente a dos candidatos reais.
 */
export function perguntarEntre(nomes: string[]): string {
  if (nomes.length === 0) return "";
  if (nomes.length === 1) return nomes[0];
  return `${nomes.slice(0, -1).join(", ")} ou ${nomes[nomes.length - 1]}`;
}
