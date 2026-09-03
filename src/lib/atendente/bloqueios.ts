/**
 * Bloqueios operacionais TEMPORÁRIOS ("hoje não temos estrogonofe de frango").
 *
 * PROBLEMA QUE ISTO RESOLVE
 * -------------------------
 * A Central da IA / Copiloto escrevia `Produto.ativo = false` para atender
 * "acabou X". Esse é o MESMO campo que o cadastro do cardápio usa, e a
 * alteração era PERMANENTE: "hoje não temos" tirava o item do cardápio
 * para sempre, sem data de volta e sem ninguém perceber.
 *
 * Aqui o bloqueio vive fora do cadastro, com validade própria:
 *
 *   "hoje não temos"   -> vale até o fim do dia operacional
 *   "por duas horas"   -> vale até agora + 2h
 *   "até eu avisar"    -> sem expiração (validoAte = null)
 *   "voltou"           -> remove o bloqueio na hora
 *
 * ONDE FICA GUARDADO
 * ------------------
 * Em `Configuracao` (chave `bloqueios_operacionais`), o mesmo mecanismo
 * chave/valor JSON que o projeto já usa para taxas, impressão e WhatsApp.
 * Sem tabela nova, sem migration: o rollback é apagar uma linha de
 * configuração, e nenhum dado de cadastro é tocado em nenhum momento.
 *
 * A expiração é por LEITURA (o bloqueio vencido some assim que alguém lê),
 * não por job agendado. Não existe cron neste projeto, e um job seria mais
 * uma peça para falhar em silêncio.
 */

import { prisma } from "@/lib/prisma";

export const CHAVE_BLOQUEIOS = "bloqueios_operacionais";

export type TipoBloqueio = "produto" | "sabor";

export interface Bloqueio {
  tipo: TipoBloqueio;
  /** Id real do Produto/Sabor no banco desta empresa. */
  id: string;
  /** Nome no momento do bloqueio — só para exibição e auditoria. */
  nome: string;
  /** ISO 8601. `null` = sem expiração automática ("até eu avisar"). */
  validoAte: string | null;
  motivo?: string;
  usuarioId?: string;
  usuarioNome?: string;
  criadoEm: string;
}

/** Hora em que o dia operacional vira (madrugada, não meia-noite). */
const HORA_VIRADA_PADRAO = 5;

/**
 * Offset fixo de São Paulo. O Brasil não tem horário de verão desde 2019,
 * então -03:00 é estável; usar offset fixo evita depender do timezone do
 * container (que em produção costuma ser UTC).
 */
const OFFSET_BR_MS = -3 * 60 * 60 * 1000;

/**
 * Fim do dia operacional: a próxima virada das 05h de Brasília.
 *
 * Restaurante que fecha 23h30 e recebe pedido até 00h20 continua sendo "o
 * mesmo dia" para quem está no balcão. Usar meia-noite liberaria o item de
 * volta no meio do expediente.
 */
export function fimDoDiaOperacional(agora: Date = new Date(), horaVirada = HORA_VIRADA_PADRAO): Date {
  const local = new Date(agora.getTime() + OFFSET_BR_MS);
  const virada = new Date(local.getTime());
  virada.setUTCHours(horaVirada, 0, 0, 0);
  if (virada.getTime() <= local.getTime()) {
    virada.setUTCDate(virada.getUTCDate() + 1);
  }
  return new Date(virada.getTime() - OFFSET_BR_MS);
}

export interface Validade {
  /** `null` = sem expiração automática. */
  validoAte: Date | null;
  /** Texto curto para confirmar ao operador o que foi entendido. */
  rotulo: string;
}

const NUMEROS: Record<string, number> = {
  uma: 1, um: 1, "1": 1,
  duas: 2, dois: 2, "2": 2,
  tres: 3, "3": 3,
  quatro: 4, "4": 4,
  cinco: 5, "5": 5,
  seis: 6, "6": 6,
};

/**
 * Interpreta a TEMPORALIDADE dita pelo operador.
 *
 * Só reconhece formas explícitas. Sem sinal de tempo, o padrão é o fim do
 * dia operacional — errar para o lado de liberar cedo demais é pior do que
 * errar para o lado de o operador ter que digitar "voltou".
 */
export function interpretarValidade(texto: string, agora: Date = new Date()): Validade {
  const t = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (/\bate\s+(eu|nova|segunda|novo)?\s*(avisar|aviso|ordem)\b/.test(t) || /\bindefinid/.test(t)) {
    return { validoAte: null, rotulo: "até você avisar" };
  }

  const mHoras = t.match(/\bpor\s+(uma|um|duas|dois|tres|quatro|cinco|seis|\d+)\s*h(?:oras?)?\b/);
  if (mHoras) {
    const n = NUMEROS[mHoras[1]] ?? Number(mHoras[1]);
    if (Number.isFinite(n) && n > 0 && n <= 24) {
      return {
        validoAte: new Date(agora.getTime() + n * 60 * 60 * 1000),
        rotulo: `pelas próximas ${n}h`,
      };
    }
  }

  const mMin = t.match(/\bpor\s+(\d+)\s*min(?:utos?)?\b/);
  if (mMin) {
    const n = Number(mMin[1]);
    if (n > 0 && n <= 1440) {
      return {
        validoAte: new Date(agora.getTime() + n * 60 * 1000),
        rotulo: `pelos próximos ${n} minutos`,
      };
    }
  }

  return { validoAte: fimDoDiaOperacional(agora), rotulo: "até o fim do dia de hoje" };
}

/* ------------------------------ Persistência ------------------------------ */

function ehValido(b: Bloqueio, agora: Date): boolean {
  if (b.validoAte === null) return true;
  const ate = new Date(b.validoAte);
  return Number.isFinite(ate.getTime()) && ate.getTime() > agora.getTime();
}

function desserializar(valor: string | null | undefined): Bloqueio[] {
  if (!valor) return [];
  try {
    const dados: unknown = JSON.parse(valor);
    if (!Array.isArray(dados)) return [];
    return dados.filter(
      (b): b is Bloqueio =>
        typeof b === "object" &&
        b !== null &&
        typeof (b as Bloqueio).id === "string" &&
        ((b as Bloqueio).tipo === "produto" || (b as Bloqueio).tipo === "sabor")
    );
  } catch {
    // Configuração corrompida não pode derrubar o atendimento: sem
    // bloqueio conhecido, o cardápio segue como está no cadastro.
    return [];
  }
}

/** Lê TODOS os bloqueios ainda válidos da empresa (expirados são ignorados). */
export async function lerBloqueios(empresaId: string, agora: Date = new Date()): Promise<Bloqueio[]> {
  const registro = await prisma.configuracao.findUnique({
    where: { empresaId_chave: { empresaId, chave: CHAVE_BLOQUEIOS } },
  });
  return desserializar(registro?.valor).filter((b) => ehValido(b, agora));
}

async function gravar(empresaId: string, lista: Bloqueio[]): Promise<void> {
  const valor = JSON.stringify(lista);
  await prisma.configuracao.upsert({
    where: { empresaId_chave: { empresaId, chave: CHAVE_BLOQUEIOS } },
    create: { empresaId, chave: CHAVE_BLOQUEIOS, valor },
    update: { valor },
  });
}

/**
 * Registra (ou substitui) o bloqueio de um item.
 *
 * Bloquear o mesmo item duas vezes não duplica: a segunda chamada
 * substitui a validade da primeira ("hoje não temos" e depois "na verdade
 * até eu avisar" resulta em um bloqueio só).
 */
export async function registrarBloqueio(
  empresaId: string,
  bloqueio: Omit<Bloqueio, "criadoEm">,
  agora: Date = new Date()
): Promise<Bloqueio[]> {
  const atuais = await lerBloqueios(empresaId, agora);
  const semEste = atuais.filter((b) => !(b.tipo === bloqueio.tipo && b.id === bloqueio.id));
  const lista = [...semEste, { ...bloqueio, criadoEm: agora.toISOString() }];
  await gravar(empresaId, lista);
  return lista;
}

/** Remove o bloqueio ("voltou a coca"). Devolve `true` se havia algo para remover. */
export async function removerBloqueio(
  empresaId: string,
  tipo: TipoBloqueio,
  id: string,
  agora: Date = new Date()
): Promise<boolean> {
  const atuais = await lerBloqueios(empresaId, agora);
  const restantes = atuais.filter((b) => !(b.tipo === tipo && b.id === id));
  if (restantes.length === atuais.length) return false;
  await gravar(empresaId, restantes);
  return true;
}

/** Conjuntos de ids bloqueados, prontos para filtrar catálogo. */
export interface IdsBloqueados {
  produtos: Set<string>;
  sabores: Set<string>;
  /** Nomes de sabor bloqueados — o catálogo do atendente trafega por nome. */
  saboresPorNome: Set<string>;
}

export async function idsBloqueados(
  empresaId: string,
  agora: Date = new Date()
): Promise<IdsBloqueados> {
  const lista = await lerBloqueios(empresaId, agora);
  return {
    produtos: new Set(lista.filter((b) => b.tipo === "produto").map((b) => b.id)),
    sabores: new Set(lista.filter((b) => b.tipo === "sabor").map((b) => b.id)),
    saboresPorNome: new Set(
      lista.filter((b) => b.tipo === "sabor").map((b) => b.nome.trim().toLowerCase())
    ),
  };
}
