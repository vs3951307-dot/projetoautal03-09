/**
 * Idempotência do lado do cliente.
 *
 * O DEFEITO QUE ISTO CORRIGE: o cardápio gerava `crypto.randomUUID()` a
 * cada TENTATIVA de envio. Se o servidor criasse o pedido e a resposta se
 * perdesse (rede caiu, aba fechou, 502 do proxy), a segunda tentativa
 * levava uma chave nova — e o backend, corretamente, criava um SEGUNDO
 * pedido. A idempotência existia no servidor e era inutilizada pelo cliente.
 *
 * Agora a chave é criada uma vez por CARRINHO e só é descartada depois de
 * o servidor confirmar sucesso.
 *
 * ---
 * CORREÇÕES DESTA REVISÃO
 *
 * 1. COLISÃO DE HASH. Antes o escopo ERA o djb2 de 32 bits: a assinatura
 *    original do carrinho era descartada. Dois carrinhos diferentes na
 *    mesma mesa que colidissem no hash compartilhavam a chave de storage,
 *    logo a mesma UUID — e o `@@unique([empresaId, idempotencyKey])` do
 *    servidor devolveria o PRIMEIRO pedido em vez de criar o segundo. O
 *    segundo pedido sumiria em silêncio. Agora a assinatura completa é
 *    guardada junto da UUID e conferida na leitura; o hash é só bucket.
 *
 * 2. TTL. Se o POST comitou no servidor mas a resposta se perdeu e o
 *    cliente nunca chamou `limparChaveIdempotencia`, um pedido IDÊNTICO
 *    posterior da mesma mesa (segunda rodada das mesmas bebidas) reusaria
 *    a chave e seria descartado pelo servidor. O TTL fecha essa janela.
 *    ESCOPO: o TTL é só do CLIENTE. Enquanto a chave existir em
 *    `Pedido.idempotencyKey`, o unique do servidor vale para sempre.
 *
 * 3. `crypto.randomUUID` exige secure context. Tablet ou celular abrindo o
 *    cardápio por HTTP puro (IP local, sem TLS) não tem a função e o envio
 *    quebrava com TypeError. Há fallback para `getRandomValues`.
 */

const PREFIXO = "pf_idem_";

/** Janela em que o cliente reaproveita a chave. Ver nota 2 acima. */
export const TTL_CHAVE_MS = 15 * 60 * 1000;

/**
 * Identificador do carrinho: mesa + conteúdo. Mudar o carrinho gera uma
 * chave nova (é outro pedido); reenviar o mesmo carrinho reaproveita a
 * chave (é a mesma tentativa).
 *
 * Retorna a assinatura COMPLETA, não um hash — ver nota 1.
 *
 * Os campos aqui devem espelhar exatamente o que o `menu-client` envia no
 * corpo do POST. Hoje são `produtoId`, `quantidade` e `tamanho`. Se o
 * cardápio passar a mandar sabores, adicionais ou observação, eles PRECISAM
 * entrar nesta assinatura — senão dois pedidos diferentes viram a mesma
 * chave e o segundo é engolido pelo dedupe do servidor.
 */
export function escopoDoCarrinho(
  mesaNumero: number,
  itens: { produtoId: string; quantidade: number; tamanho?: string | null }[]
): string {
  const assinatura = itens
    .map((i) => `${i.produtoId}:${i.quantidade}:${i.tamanho ?? ""}`)
    .sort()
    .join("|");
  return `${mesaNumero}::${assinatura}`;
}

/** Hash curto e estável (djb2) — SÓ para encurtar a chave do storage. */
function bucketDoEscopo(escopo: string): string {
  let h = 5381;
  for (let i = 0; i < escopo.length; i++) h = ((h << 5) + h + escopo.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}_${escopo.length.toString(36)}`;
}

function novaUuid(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  if (typeof c?.getRandomValues === "function") {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  throw new Error("Sem fonte de aleatoriedade para gerar a chave de idempotência.");
}

interface RegistroIdempotencia {
  escopo: string;
  chave: string;
  criadoEm: number;
}

function lerRegistro(bucket: string): RegistroIdempotencia | null {
  const bruto = window.sessionStorage.getItem(bucket);
  if (!bruto) return null;
  try {
    const dados = JSON.parse(bruto) as Partial<RegistroIdempotencia>;
    if (
      typeof dados.escopo !== "string" ||
      typeof dados.chave !== "string" ||
      typeof dados.criadoEm !== "number"
    ) {
      return null; // registro legado (UUID cru) ou corrompido: não é conferível
    }
    if (Date.now() - dados.criadoEm > TTL_CHAVE_MS) return null;
    return dados as RegistroIdempotencia;
  } catch {
    return null;
  }
}

export function obterChaveIdempotencia(escopo: string): string {
  if (typeof window === "undefined") return novaUuid();
  const bucket = PREFIXO + bucketDoEscopo(escopo);
  const registro = lerRegistro(bucket);
  // Só reaproveita se o escopo guardado for EXATAMENTE este carrinho.
  if (registro && registro.escopo === escopo) return registro.chave;

  const nova = novaUuid();
  window.sessionStorage.setItem(
    bucket,
    JSON.stringify({ escopo, chave: nova, criadoEm: Date.now() } satisfies RegistroIdempotencia)
  );
  return nova;
}

/**
 * Só depois de SUCESSO confirmado. Em erro, a chave precisa sobreviver.
 * Não apaga registro de OUTRO carrinho que tenha caído no mesmo bucket.
 */
export function limparChaveIdempotencia(escopo: string): void {
  if (typeof window === "undefined") return;
  const bucket = PREFIXO + bucketDoEscopo(escopo);
  const registro = lerRegistro(bucket);
  if (registro && registro.escopo !== escopo) return;
  window.sessionStorage.removeItem(bucket);
}
