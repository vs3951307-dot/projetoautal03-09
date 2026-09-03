/**
 * Tokens públicos do cardápio digital por mesa.
 *
 * O token é a ÚNICA coisa que o cliente na mesa apresenta ao servidor.
 * Ele nunca envia o número da mesa nem o id da empresa: os dois são
 * derivados do token, no servidor. Assim não existe "trocar o número na
 * URL" para pedir na conta de outra mesa ou de outro restaurante.
 *
 * Regenerar o QR revoga TODOS os tokens ativos da mesa e cria um novo, na
 * mesma transação — o link impresso/fotografado antigo para de funcionar
 * imediatamente.
 */

import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

/** 32 bytes de entropia — inviável de adivinhar, curto o bastante para caber num QR. */
export function gerarToken(): string {
  return randomBytes(24).toString("base64url");
}

export interface MesaResolvida {
  empresaId: string;
  empresaNome: string;
  empresaSlug: string;
  mesaId: number;
  mesaNumero: number;
}

/**
 * Resolve o token público em empresa + mesa.
 *
 * O `empresaSlug` da URL é conferido contra a empresa DONA do token: um
 * token válido da empresa A apresentado na URL da empresa B é recusado,
 * mesmo sendo um token real.
 *
 * Devolve `null` para token inexistente, revogado, mesa de outra empresa,
 * ou empresa inativa — sem distinguir os casos, para não virar um oráculo
 * de "este token existe".
 */
export async function resolverTokenMesa(
  empresaSlug: string,
  token: string
): Promise<MesaResolvida | null> {
  const limpo = String(token ?? "").trim();
  if (!limpo || limpo.length > 128) return null;

  const empresa = await prisma.empresa.findUnique({ where: { slug: empresaSlug } });
  if (!empresa) return null;
  if (!["ativa", "teste"].includes(empresa.status)) return null;

  const registro = await prisma.mesaTokenAcesso.findUnique({
    where: { empresaId_token: { empresaId: empresa.id, token: limpo } },
    include: { mesa: true },
  });
  if (!registro || !registro.ativo) return null;
  // Defesa em profundidade: a mesa também precisa ser da mesma empresa.
  if (registro.mesa.empresaId !== empresa.id) return null;

  return {
    empresaId: empresa.id,
    empresaNome: empresa.nome,
    empresaSlug: empresa.slug,
    mesaId: registro.mesa.id,
    mesaNumero: registro.mesa.numero,
  };
}

/**
 * Cria um token novo para a mesa e revoga os anteriores.
 *
 * Em transação: nunca existe um instante com dois tokens ativos nem um
 * instante sem nenhum.
 */
export async function regenerarTokenMesa(
  empresaId: string,
  mesaNumero: number,
  criadoPor?: string
): Promise<{ token: string; mesaNumero: number } | null> {
  const mesa = await prisma.mesa.findUnique({
    where: { empresaId_numero: { empresaId, numero: mesaNumero } },
  });
  if (!mesa) return null;

  const token = gerarToken();
  await prisma.$transaction([
    prisma.mesaTokenAcesso.updateMany({
      where: { empresaId, mesaId: mesa.id, ativo: true },
      data: { ativo: false, revogadoEm: new Date() },
    }),
    prisma.mesaTokenAcesso.create({
      data: { empresaId, mesaId: mesa.id, token, criadoPor: criadoPor ?? null },
    }),
  ]);
  return { token, mesaNumero: mesa.numero };
}

/** Token ativo atual da mesa; cria um na primeira vez. */
export async function tokenAtualDaMesa(
  empresaId: string,
  mesaNumero: number,
  criadoPor?: string
): Promise<{ token: string; mesaNumero: number } | null> {
  const mesa = await prisma.mesa.findUnique({
    where: { empresaId_numero: { empresaId, numero: mesaNumero } },
  });
  if (!mesa) return null;

  const existente = await prisma.mesaTokenAcesso.findFirst({
    where: { empresaId, mesaId: mesa.id, ativo: true },
    orderBy: { criadoEm: "desc" },
  });
  if (existente) return { token: existente.token, mesaNumero: mesa.numero };
  return regenerarTokenMesa(empresaId, mesaNumero, criadoPor);
}

/** URL pública do cardápio da mesa. */
export function urlDoCardapio(baseUrl: string, empresaSlug: string, token: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/cardapio/${encodeURIComponent(empresaSlug)}/mesa/${encodeURIComponent(token)}`;
}
