/**
 * Extração determinística de um pedido COMPLETO enviado numa mensagem só.
 *
 * "Meu nome é Victor, quero uma pizza grande, metade calabresa e metade
 * estrogonofe de carne, vou retirar e pagar no Pix."
 *
 * A FSM sozinha lê isso como resposta à pergunta atual e joga o resto
 * fora — ou pior, guarda "pagar no pix" em `estado.pendentes` e depois
 * procura um produto com esse nome. Aqui a frase inteira é quebrada em
 * SLOTS antes de a FSM ver qualquer coisa.
 *
 * Princípios (não negociáveis, é aqui que se vende errado):
 *
 *  - Só entra o que é EXPLÍCITO. Nada é inferido, completado ou chutado.
 *  - Tudo é validado contra o catálogo REAL do tenant, que chega por
 *    parâmetro (`CatalogoExtracao`) — este módulo não conhece o banco.
 *  - Empate vira AMBIGUIDADE, nunca escolha. Quem pergunta é o motor.
 *  - Uma palavra solta não reescreve pedido: a extração só é considerada
 *    válida quando reconhece pelo menos dois slots distintos, ou um item
 *    de catálogo com atributo. Ver `reconheceu`.
 *
 * Sem banco, sem IA, sem rede: dá para testar inteiro.
 */

import { resolver, normalizar } from "@/lib/atendente/resolver";
import { lerSabores } from "@/lib/atendente/sabores";

/* --------------------------------- Tipos ---------------------------------- */

export interface TamanhoCatalogo {
  nome: string;
  valor: number;
}
export interface SaborCatalogo {
  nome: string;
  tipo: string;
}
export interface ProdutoCatalogo {
  id: string;
  nome: string;
  temTamanhos: boolean;
  temSabores: boolean;
  tamanhos: TamanhoCatalogo[];
  sabores: SaborCatalogo[];
}

export interface CatalogoExtracao {
  produtos: ProdutoCatalogo[];
  adicionais: { nome: string; preco: number }[];
  formasPagamento: { value: string; label: string }[];
}

export interface Ambiguidade {
  campo: "produto" | "sabor" | "tamanho";
  /** Trecho exato que o cliente escreveu. */
  termo: string;
  candidatos: string[];
  /** Índice do item ao qual a ambiguidade pertence (para `sabor`/`tamanho`). */
  item?: number;
}

export interface ItemExtraido {
  produto: ProdutoCatalogo;
  quantidade?: number;
  tamanho?: TamanhoCatalogo;
  sabores: string[];
  /** Quantos sabores o cliente pediu no total (2 = meio a meio). */
  saboresPedidos?: number;
  adicionais: { nome: string; preco: number }[];
  observacao?: string;
}

export interface SlotsExtraidos {
  nome?: string;
  itens: ItemExtraido[];
  canal?: "entrega" | "retirada";
  endereco?: { rua: string; bairro: string };
  formaPagamento?: string;
  trocoPara?: number;
  observacoes: string[];
  ambiguidades: Ambiguidade[];
  /** Trechos que não casaram com nada — nunca viram produto nem pendência. */
  desconhecidos: string[];
  /**
   * `true` quando a extração é confiável o bastante para sobrescrever o
   * fluxo da FSM. Ver a regra "uma palavra solta não reescreve pedido".
   */
  reconheceu: boolean;
  /** Quais slots foram preenchidos — usado no log e nos testes. */
  slots: string[];
}

/* ------------------------------ Padrões fixos ----------------------------- */

const RE_NOME =
  /\b(?:meu\s+nome\s+(?:e|é|eh)|me\s+chamo|sou\s+(?:o|a)|em\s+nome\s+de|no\s+nome\s+de|nome\s*:)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]*(?:\s+(?:d[aeo]s?\s+)?[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]*){0,3})/i;

/** Palavras que encerram o nome (o cliente emendou outra informação). */
const CORTA_NOME =
  /^(quero|queria|gostaria|vou|pago|pagar|e|com|sem|manda|me|pra|para|de|da|do|uma|um|meia|metade|pizza|lanche|bebida|coca|retirada|entrega|pix|dinheiro|cartao|cartão)$/i;

const RE_RETIRADA =
  /\b(vou\s+(buscar|busca|retirar|pegar|passar|ai|a[ií])|retirada|retirar|pego\s+no\s+local|no\s+balc[aã]o|na\s+loja)\b/i;
const RE_ENTREGA = /\b(entrega|delivery|entregar|manda\s+(aqui|em\s+casa|pra|para)|traz\s+aqui|em\s+casa)\b/i;

const RE_TROCO = /\btroco\s*(?:para|pra|de)?\s*(?:r\$\s*)?(\d{1,4})\b/i;
const RE_SEM_TROCO = /\b(sem\s+troco|n[aã]o\s+precisa\s+de\s+troco|troco\s+n[aã]o)\b/i;

const RE_ENDERECO =
  /\b(?:rua|av\.?|avenida|travessa|alameda|estrada|rodovia)\s+([^,;.]{3,60})(?:\s*[,;]\s*(?:bairro\s+)?([^,;.]{2,40}))?/i;

/** "sem cebola", "sem azeitona" — observação, nunca produto. */
const RE_SEM_INGREDIENTE = /\bsem\s+([a-zà-ÿ]{3,20}(?:\s+[a-zà-ÿ]{3,20})?)\b/gi;

const RE_MEIO = /\b(metade|metd|meia|meio\s*a\s*meio|1\s*\/\s*2|1\/2)\b/i;

const NUMEROS: Record<string, number> = {
  uma: 1, um: 1, "1": 1,
  duas: 2, dois: 2, "2": 2,
  tres: 3, "3": 3,
  quatro: 4, "4": 4,
  cinco: 5, "5": 5,
};

/** Palavras que nunca devem ser confundidas com produto/sabor. */
const RUIDO = new Set([
  "quero", "queria", "gostaria", "pedir", "pedido", "favor", "por", "manda",
  "vou", "pago", "pagar", "pagamento", "retirar", "retirada", "buscar",
  "entrega", "entregar", "delivery", "casa", "troco", "nome", "chamo",
  "sou", "meu", "minha", "uma", "um", "duas", "dois", "e", "de", "da", "do",
  "com", "sem", "no", "na", "em", "pra", "para", "ai", "obrigado", "bom",
  "boa", "noite", "dia", "tarde", "oi", "ola", "hey",
]);

/* ------------------------------- Utilidades ------------------------------- */

function limparRuido(seg: string): string {
  return normalizar(seg)
    .split(" ")
    .filter((t) => t.length > 0 && !RUIDO.has(t))
    .join(" ")
    .trim();
}

function quantidadeNoSegmento(seg: string): number | undefined {
  const m = normalizar(seg).match(/\b(\d{1,2}|uma?|duas|dois|tres|quatro|cinco)\b/);
  if (!m) return undefined;
  const n = NUMEROS[m[1]] ?? Number(m[1]);
  return Number.isFinite(n) && n >= 1 && n <= 20 ? n : undefined;
}

/**
 * Remove um trecho do texto pelo índice do match, para que a mesma
 * palavra não seja contada duas vezes (ex.: "pix" virando sabor).
 */
function remover(texto: string, alvo: string | undefined): string {
  if (!alvo) return texto;
  const i = texto.toLowerCase().indexOf(alvo.toLowerCase());
  if (i < 0) return texto;
  return `${texto.slice(0, i)} , ${texto.slice(i + alvo.length)}`;
}

/* -------------------------------- Extração -------------------------------- */

export function extrairPedido(texto: string, catalogo: CatalogoExtracao): SlotsExtraidos {
  const saida: SlotsExtraidos = {
    itens: [],
    observacoes: [],
    ambiguidades: [],
    desconhecidos: [],
    reconheceu: false,
    slots: [],
  };
  let restante = ` ${texto} `;

  /* --- nome ------------------------------------------------------------- */
  const mNome = restante.match(RE_NOME);
  if (mNome) {
    const palavras = mNome[1].trim().split(/\s+/);
    const nome: string[] = [];
    for (const p of palavras) {
      if (CORTA_NOME.test(p)) break;
      nome.push(p);
    }
    if (nome.length > 0 && nome.length <= 4) {
      saida.nome = nome
        .map((p) =>
          /^(de|da|do|dos|das)$/i.test(p) ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
        )
        .join(" ");
      saida.slots.push("nome");
      restante = remover(restante, mNome[0]);
    }
  }

  /* --- endereço (antes do canal: "manda na rua X" implica entrega) ------- */
  const mEnd = restante.match(RE_ENDERECO);
  if (mEnd) {
    saida.endereco = { rua: mEnd[1].trim(), bairro: (mEnd[2] ?? "").trim() };
    saida.slots.push("endereco");
    restante = remover(restante, mEnd[0]);
  }

  /* --- canal ------------------------------------------------------------- */
  const mRet = restante.match(RE_RETIRADA);
  const mEnt = restante.match(RE_ENTREGA);
  if (mRet) {
    saida.canal = "retirada";
    saida.slots.push("canal");
    restante = remover(restante, mRet[0]);
  } else if (mEnt || saida.endereco) {
    saida.canal = "entrega";
    saida.slots.push("canal");
    if (mEnt) restante = remover(restante, mEnt[0]);
  }

  /* --- troco ------------------------------------------------------------- */
  const mTroco = restante.match(RE_TROCO);
  if (mTroco) {
    saida.trocoPara = Number(mTroco[1]);
    saida.slots.push("troco");
    restante = remover(restante, mTroco[0]);
  } else {
    const mSem = restante.match(RE_SEM_TROCO);
    if (mSem) {
      saida.trocoPara = 0;
      saida.slots.push("troco");
      restante = remover(restante, mSem[0]);
    }
  }

  /* --- pagamento --------------------------------------------------------- */
  for (const forma of catalogo.formasPagamento) {
    const alvo = new RegExp(`\\b${normalizar(forma.label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const alvoValor = new RegExp(`\\b${forma.value}\\b`, "i");
    const n = normalizar(restante);
    if (alvo.test(n) || alvoValor.test(n)) {
      saida.formaPagamento = forma.value;
      saida.slots.push("pagamento");
      restante = restante.replace(new RegExp(forma.label, "i"), " , ").replace(new RegExp(`\\b${forma.value}\\b`, "i"), " , ");
      break;
    }
  }
  if (!saida.formaPagamento) {
    const apelidos: [RegExp, string][] = [
      [/\bpix\b/i, "pix"],
      [/\bdinheiro|esp[eé]cie\b/i, "dinheiro"],
      [/\bd[eé]bito\b/i, "debito"],
      [/\bcr[eé]dito\b/i, "credito"],
      [/\bcart[aã]o\b/i, "credito"],
    ];
    for (const [re, valor] of apelidos) {
      if (re.test(restante) && catalogo.formasPagamento.some((f) => f.value === valor)) {
        saida.formaPagamento = valor;
        saida.slots.push("pagamento");
        restante = restante.replace(re, " , ");
        break;
      }
    }
  }

  /* --- observações "sem X" ---------------------------------------------- */
  RE_SEM_INGREDIENTE.lastIndex = 0;
  let mSem: RegExpExecArray | null;
  const observados: string[] = [];
  while ((mSem = RE_SEM_INGREDIENTE.exec(restante)) !== null) {
    const ingrediente = mSem[1].trim();
    if (/^(troco|cebola|az|dinheiro)$/i.test(ingrediente) && ingrediente.toLowerCase() === "troco") continue;
    observados.push(`sem ${ingrediente}`);
  }
  for (const obs of observados) {
    saida.observacoes.push(obs);
    restante = remover(restante, obs);
  }
  if (saida.observacoes.length > 0) saida.slots.push("observacao");

  /* --- itens ------------------------------------------------------------- */
  const meioAMeio = RE_MEIO.test(restante);
  const segmentos = restante
    .split(/\s+\be\b\s+|[,;]|\s+\+\s+|\bmais\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  let atual: ItemExtraido | null = null;
  for (const bruto of segmentos) {
    const seg = limparRuido(bruto.replace(RE_MEIO, " "));
    if (seg.length < 2) continue;

    // 1) É um sabor do item que está sendo montado? (tem prioridade: numa
    //    pizzaria "calabresa" pode ser sabor E nome de produto.)
    if (atual && atual.produto.sabores.length > 0) {
      const rs = resolver(seg, atual.produto.sabores);
      if (rs.tipo === "EXACT" || rs.tipo === "UNIQUE") {
        if (!atual.sabores.includes(rs.escolhido!.nome)) atual.sabores.push(rs.escolhido!.nome);
        continue;
      }
      if (rs.tipo === "MULTIPLE") {
        saida.ambiguidades.push({
          campo: "sabor",
          termo: seg,
          candidatos: rs.candidatos.map((c) => c.nome),
          item: saida.itens.length - 1,
        });
        continue;
      }
    }

    // 2) É um tamanho do item atual?
    if (atual && atual.produto.tamanhos.length > 0) {
      const rt = resolver(seg, atual.produto.tamanhos);
      if (rt.tipo === "EXACT" || rt.tipo === "UNIQUE") {
        atual.tamanho = rt.escolhido as TamanhoCatalogo;
        continue;
      }
    }

    // 3) É um produto? (abre um item novo)
    const rp = resolver(seg, catalogo.produtos);
    if (rp.tipo === "EXACT" || rp.tipo === "UNIQUE") {
      const produto = rp.escolhido as ProdutoCatalogo;
      atual = {
        produto,
        quantidade: quantidadeNoSegmento(bruto),
        sabores: [],
        adicionais: [],
      };
      saida.itens.push(atual);

      // O MESMO segmento costuma trazer tamanho, sabores e adicional juntos:
      // "uma pizza grande calabresa com borda de catupiry". Se só o produto
      // fosse lido aqui, o resto se perderia e o bot perguntaria de novo.
      if (produto.tamanhos.length > 0) {
        for (const t of produto.tamanhos) {
          if (new RegExp(`\\b${normalizar(t.nome)}`, "i").test(normalizar(bruto))) {
            atual.tamanho = t;
            break;
          }
        }
      }
      if (produto.sabores.length > 0) {
        const leitura = lerSabores(bruto, produto.sabores);
        for (const nome of leitura.resolvidos) {
          if (!atual.sabores.includes(nome)) atual.sabores.push(nome);
        }
        for (const amb of leitura.ambiguos) {
          saida.ambiguidades.push({
            campo: "sabor",
            termo: amb.termo,
            candidatos: amb.candidatos,
            item: saida.itens.length - 1,
          });
        }
        // O que não é sabor ainda pode ser adicional; o que não for nem um
        // nem outro fica registrado como desconhecido — nunca vira produto.
        for (const trecho of leitura.desconhecidos) {
          const ra = catalogo.adicionais.length > 0 ? resolver(trecho, catalogo.adicionais) : null;
          if (ra && (ra.tipo === "EXACT" || ra.tipo === "UNIQUE")) {
            atual.adicionais.push(ra.escolhido as { nome: string; preco: number });
          } else {
            saida.desconhecidos.push(trecho);
          }
        }
      }
      continue;
    }
    if (rp.tipo === "MULTIPLE") {
      saida.ambiguidades.push({
        campo: "produto",
        termo: seg,
        candidatos: rp.candidatos.map((c) => c.nome),
      });
      continue;
    }

    // 4) É um adicional?
    if (catalogo.adicionais.length > 0 && atual) {
      const ra = resolver(seg, catalogo.adicionais);
      if (ra.tipo === "EXACT" || ra.tipo === "UNIQUE") {
        atual.adicionais.push(ra.escolhido as { nome: string; preco: number });
        continue;
      }
    }

    // 5) Nada bateu. NÃO vira pendência e NÃO vira produto inventado.
    saida.desconhecidos.push(seg);
  }

  // Quantos sabores o cliente pediu para o primeiro item com sabores.
  for (const item of saida.itens) {
    if (item.produto.sabores.length === 0) continue;
    const citados =
      item.sabores.length + saida.ambiguidades.filter((a) => a.campo === "sabor").length;
    if (meioAMeio && citados <= 1) item.saboresPedidos = 2;
    else if (citados >= 1) item.saboresPedidos = citados;
  }

  if (saida.itens.length > 0) saida.slots.push("item");
  if (saida.itens.some((i) => i.tamanho)) saida.slots.push("tamanho");
  if (saida.itens.some((i) => i.sabores.length > 0)) saida.slots.push("sabor");

  /**
   * REGRA 11: uma palavra isolada não reescreve o pedido. A extração só é
   * confiável com dois slots distintos, ou com um item de catálogo que
   * trouxe algum atributo junto (tamanho/sabor/quantidade).
   */
  const slotsDistintos = new Set(saida.slots).size;
  const itemComAtributo = saida.itens.some(
    (i) => i.tamanho || i.sabores.length > 0 || i.quantidade !== undefined
  );
  saida.reconheceu = slotsDistintos >= 2 || (saida.itens.length > 0 && itemComAtributo);

  return saida;
}
