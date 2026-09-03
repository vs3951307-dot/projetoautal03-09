/**
 * Delivery (PEDIDO 17) — regras de negócio do fluxo de entrega:
 * taxa por bairro configurável, previsão e estados da entrega.
 *
 * A taxa é calculada pelo próprio sistema (regras em `config taxas`,
 * editáveis no admin) — sem geolocalização externa nesta etapa.
 *
 * Regras de taxa (PEDIDO 13):
 *   - `fixa`     — mesmo valor para todos.
 *   - `bairro`   — valor por bairro, com fallback para `valorPadrao` e
 *                  lista de bairros que NÃO são atendidos.
 *   - `distancia`— taxa base somada ao valor por quilômetro
 *                  (taxaBase + valorPorKm * km), com taxa mínima e raio
 *                  máximo (acima do raio não atende).
 *
 * Ajuda humana: quando o endereço é duvidoso (ex.: o cliente não informou
 * o bairro num pedido de entrega por distância), `calcularTaxaEntrega`
 * devolve `exigeHumano = true` para que o atendente humano confirme a taxa.
 */

import { prisma } from "@/lib/prisma";

export const STATUS_ENTREGA = ["aguardando", "preparo", "rota", "entregue", "cancelada"] as const;

export type StatusEntrega = (typeof STATUS_ENTREGA)[number];

export interface BairroTaxa {
  bairro: string;
  valor: number;
}

/** Regras configuráveis da taxa de entrega (config `taxas` → `taxaEntrega`). */
export interface ConfigTaxaEntrega {
  /** `fixa` = mesmo valor para todos; `bairro` = valor por bairro; `distancia` = por km. */
  regra: "fixa" | "bairro" | "distancia";
  /** Valor usado na regra `fixa` (e na UI como referência). */
  valorFixo: number;
  /** Bairros não listados, quando a regra é por bairro. */
  valorPadrao: number;
  /** Pedidos com subtotal >= este valor não pagam taxa (0 = nunca grátis). */
  gratisAcima: number;
  bairros: BairroTaxa[];
  /** Bairros onde NÃO há entrega (qualquer regra). */
  bairrosNaoAtendidos: string[];
  /** Regra por distância: taxa base fixa cobrada antes de somar a distância. */
  taxaBase: number;
  /** Regra por distância: custo por quilômetro. */
  valorPorKm: number;
  /** Regra por distância: taxa mínima cobrada (mesmo abaixo do 1º km). */
  taxaMinima: number;
  /** Regra por distância: raio máximo de entrega em km (acima não atende). */
  raioMaximoKm: number;
  /**
   * Coordenadas (lat/lng) da loja/endereço de referência. Usadas para
   * calcular a distância (fórmula de Haversine) quando o cliente
   * compartilha a localização nativa do WhatsApp. Opcional: sem isso, um
   * pedido por distância continua exigindo confirmação humana.
   */
  pontoReferencia?: { lat: number; lng: number };
}

export const TAXA_ENTREGA_PADRAO: ConfigTaxaEntrega = {
  regra: "bairro",
  valorFixo: 5.0,
  valorPadrao: 9.9,
  gratisAcima: 0,
  bairros: [
    { bairro: "Centro", valor: 5.0 },
    { bairro: "Bela Vista", valor: 6.5 },
    { bairro: "Consolação", valor: 7.5 },
    { bairro: "Jardins", valor: 8.5 },
    { bairro: "Itaim Bibi", valor: 9.5 },
    { bairro: "Vila Mariana", valor: 10.5 },
    { bairro: "Paraíso", valor: 8.0 },
  ],
  bairrosNaoAtendidos: [],
  taxaBase: 0,
  valorPorKm: 2.5,
  taxaMinima: 6.0,
  raioMaximoKm: 20,
  pontoReferencia: undefined,
};

/** Normaliza qualquer formato persistido (novo ou legado) para a config atual. */
export function normalizarConfigTaxaEntrega(valor: unknown): ConfigTaxaEntrega {
  if (!valor || typeof valor !== "object") return TAXA_ENTREGA_PADRAO;
  const v = valor as Record<string, unknown>;
  const bairros = Array.isArray(v.bairros)
    ? (v.bairros as Record<string, unknown>[])
        .map((b) => ({
          bairro: String(b.bairro ?? "").trim(),
          valor: Math.max(0, Number(b.valor ?? 0)),
        }))
        .filter((b) => b.bairro)
    : [];
  const bairrosNaoAtendidos = Array.isArray(v.bairrosNaoAtendidos)
    ? (v.bairrosNaoAtendidos as unknown[])
        .map((b) => String(b ?? "").trim())
        .filter(Boolean)
    : [];
  const regra = v.regra === "bairro" || v.regra === "distancia" ? v.regra : "fixa";
  let pontoReferencia: { lat: number; lng: number } | undefined;
  const pr = v.pontoReferencia as { lat?: unknown; lng?: unknown } | undefined;
  if (pr && Number.isFinite(Number(pr.lat)) && Number.isFinite(Number(pr.lng))) {
    pontoReferencia = { lat: Number(pr.lat), lng: Number(pr.lng) };
  }
  return {
    regra,
    valorFixo: Math.max(0, Number(v.valorFixo ?? 0)),
    valorPadrao: Math.max(0, Number(v.valorPadrao ?? (v as { valorFixo?: number }).valorFixo ?? 0)),
    gratisAcima: Math.max(0, Number(v.gratisAcima ?? 0)),
    bairros,
    bairrosNaoAtendidos,
    taxaBase: Math.max(0, Number(v.taxaBase ?? 0)),
    valorPorKm: Math.max(0, Number(v.valorPorKm ?? TAXA_ENTREGA_PADRAO.valorPorKm ?? 0)),
    taxaMinima: Math.max(0, Number(v.taxaMinima ?? TAXA_ENTREGA_PADRAO.taxaMinima ?? 0)),
    raioMaximoKm: Math.max(0, Number(v.raioMaximoKm ?? TAXA_ENTREGA_PADRAO.raioMaximoKm ?? 0)),
    ...(pontoReferencia ? { pontoReferencia } : {}),
  };
}

/** Lê a config da taxa de entrega do banco (fallback: padrão). Escopo por empresa. */
export async function lerConfigTaxaEntrega(empresaId: string): Promise<ConfigTaxaEntrega> {
  const registro = await prisma.configuracao.findUnique({
    where: { empresaId_chave: { empresaId, chave: "taxas" } },
  });
  if (!registro) return TAXA_ENTREGA_PADRAO;
  try {
    const valor = JSON.parse(registro.valor) as { taxaEntrega?: unknown };
    return normalizarConfigTaxaEntrega(valor.taxaEntrega);
  } catch {
    return TAXA_ENTREGA_PADRAO;
  }
}

export interface ResultadoTaxaEntrega {
  taxa: number;
  regra: "fixa" | "bairro" | "distancia" | "gratuito";
  gratuito: boolean;
  /** `false` quando o bairro/distância não é atendido (não há entrega). */
  atende: boolean;
  /** Motivo para não atender (bairro fora da área ou raio excedido). */
  motivo?: string;
  /** Quando duvidosa (endereço sem bairro), pede confirmação humana. */
  exigeHumano: boolean;
  /** Nº de km usado quando a regra é por distância. */
  distanciaKm?: number;
}

/** Opções de cálculo — endereço da entrega. */
export interface OpcoesTaxaEntrega {
  distanciaEmKm?: number;
}

const BRUTO2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Distância em linha reta (km) entre dois pontos (lat/lng), pela fórmula
 * de Haversine. Usada quando o cliente compartilha a localização nativa
 * do WhatsApp e a loja tem `pontoReferencia` configurado.
 */
export function distanciaKmHaversine(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371;
  const dLat = (b.lat - a.lat) * (Math.PI / 180);
  const dLng = (b.lng - a.lng) * (Math.PI / 180);
  const sla = Math.sin(dLat / 2) * Math.sin(dLat / 2);
  const slb = Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const h = sla + Math.cos(a.lat * (Math.PI / 180)) * Math.cos(b.lat * (Math.PI / 180)) * slb;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
}

/** Bairro normalizado (minúsculas, sem espaços ao redor). */
function normalizar(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Calcula a taxa de entrega por regra configurada (bairro/distância + subtotal).
 *
 * Backwards-compatible: mantém a assinatura anterior `(config, bairro, subtotal)`;
 * o novo parâmetro `opcoes` é opcional e aditivo.
 */
export function calcularTaxaEntrega(
  config: ConfigTaxaEntrega,
  bairro: string | null | undefined,
  subtotal: number,
  opcoes?: OpcoesTaxaEntrega
): ResultadoTaxaEntrega {
  // Bairro explicitamente marcado como NÃO atendido → sem delivery.
  if (bairro && config.bairrosNaoAtendidos.length > 0) {
    const limpo = normalizar(bairro);
    if (config.bairrosNaoAtendidos.some((b) => normalizar(b) === limpo)) {
      return {
        taxa: 0,
        regra: "fixa",
        gratuito: false,
        atende: false,
        motivo: "não atendemos nesse bairro para entrega",
        exigeHumano: false,
      };
    }
  }
  if (config.gratisAcima > 0 && subtotal >= config.gratisAcima) {
    return { taxa: 0, regra: "gratuito", gratuito: true, atende: true, exigeHumano: false };
  }

  if (config.regra === "bairro") {
    if (config.bairros.length > 0 && bairro) {
      const limpo = normalizar(bairro);
      const encontrado = config.bairros.find((b) => normalizar(b.bairro) === limpo);
      return {
        taxa: BRUTO2(encontrado?.valor ?? config.valorPadrao),
        regra: "bairro",
        gratuito: false,
        atende: true,
        exigeHumano: false,
      };
    }
    // Regra por bairro SEM bairro informado: cobra padrão, mas pede confirmação
    // do atendente por ser um endereço duvidoso.
    return {
      taxa: BRUTO2(config.valorPadrao),
      regra: "bairro",
      gratuito: false,
      atende: false,
      motivo: "bairro não informado",
      exigeHumano: true,
    };
  }

  if (config.regra === "distancia") {
    const km = Number.isFinite(opcoes?.distanciaEmKm) ? Math.max(0, opcoes!.distanciaEmKm!) : null;
    // Sem km é um endereço duvidoso → pede confirmação humana.
    if (km === null) {
      return {
        taxa: BRUTO2(config.taxaMinima),
        regra: "distancia",
        gratuito: false,
        atende: false,
        motivo: "distância não informada",
        exigeHumano: true,
      };
    }
    if (config.raioMaximoKm > 0 && km > config.raioMaximoKm) {
      return {
        taxa: 0,
        regra: "distancia",
        gratuito: false,
        atende: false,
        motivo: `distância de ${km} km excede o raio máximo de ${config.raioMaximoKm} km`,
        exigeHumano: false,
        distanciaKm: km,
      };
    }
    // A distância TARIFADA é arredondada PARA CIMA ao km inteiro (regra
    // comercial da Rozeno): aprox. 13 km cobra como 13 km → 1 + 13 = R$14.
    // O km bruto original (Haversine) é preservado em `distanciaKm` para
    // auditoria; a conta usa `kmCobrado`.
    const kmCobrado = Math.ceil(km);
    const calculado = config.taxaBase + kmCobrado * (config.valorPorKm > 0 ? config.valorPorKm : 0);
    const taxa = config.taxaMinima > 0 ? Math.max(config.taxaMinima, calculado) : calculado;
    return {
      taxa: BRUTO2(taxa),
      regra: "distancia",
      gratuito: false,
      atende: true,
      exigeHumano: false,
      distanciaKm: km,
    };
  }

  return { taxa: BRUTO2(config.valorFixo), regra: "fixa", gratuito: false, atende: true, exigeHumano: false };
}

/** Previsão padrão usada quando o caixa não informa uma previsão. */
export function previsaoEntregaPadrao(): string {
  return "35–45 min";
}
