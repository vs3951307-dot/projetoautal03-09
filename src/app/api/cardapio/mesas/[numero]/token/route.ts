import { NextRequest, NextResponse } from "next/server";
import { comTratamentoDeErro } from "@/lib/api-erro";
import { autorizar, registrarAuditoria } from "@/lib/acesso";
import { prisma } from "@/lib/prisma";
import { regenerarTokenMesa, tokenAtualDaMesa, urlDoCardapio } from "@/lib/cardapio/tokens";

function baseUrl(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
}

/** O slug vem SEMPRE do empresaId da sessão, nunca da requisição. */
async function slugDaEmpresa(empresaId: string): Promise<string> {
  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { slug: true } });
  return empresa?.slug ?? "";
}

/** GET — token atual da mesa (cria na primeira vez). Admin/salão. */
export const GET = comTratamentoDeErro(
  "cardapio.mesas.token.GET",
  async (req: NextRequest, { params }: { params: { numero: string } }) => {
    const acesso = await autorizar("salao");
    if (!acesso.ok) return acesso.resposta;
    const numero = Number(params.numero);
    if (!Number.isInteger(numero)) return NextResponse.json({ erro: "Mesa inválida." }, { status: 400 });

    const r = await tokenAtualDaMesa(acesso.empresaId, numero, acesso.usuario?.id);
    if (!r) return NextResponse.json({ erro: "Mesa não encontrada." }, { status: 404 });
    const slug = await slugDaEmpresa(acesso.empresaId);
    return NextResponse.json({
      mesa: r.mesaNumero,
      url: urlDoCardapio(baseUrl(req), slug, r.token),
    });
  }
);

/**
 * POST — regenera o token: o QR antigo para de funcionar na hora.
 * Ação sensível: fica na auditoria com quem fez.
 */
export const POST = comTratamentoDeErro(
  "cardapio.mesas.token.POST",
  async (req: NextRequest, { params }: { params: { numero: string } }) => {
    const acesso = await autorizar("salao");
    if (!acesso.ok) return acesso.resposta;
    const numero = Number(params.numero);
    if (!Number.isInteger(numero)) return NextResponse.json({ erro: "Mesa inválida." }, { status: 400 });

    const r = await regenerarTokenMesa(acesso.empresaId, numero, acesso.usuario?.id);
    if (!r) return NextResponse.json({ erro: "Mesa não encontrada." }, { status: 404 });

    await registrarAuditoria(
      "cardapio_token_regenerado",
      `Mesa ${numero}: QR Code regenerado (links anteriores revogados)`,
      acesso.usuario,
      undefined,
      acesso.empresaId
    );
    const slug = await slugDaEmpresa(acesso.empresaId);
    return NextResponse.json({
      mesa: r.mesaNumero,
      url: urlDoCardapio(baseUrl(req), slug, r.token),
    });
  }
);
