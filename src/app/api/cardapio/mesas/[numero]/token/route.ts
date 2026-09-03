import { NextRequest, NextResponse } from "next/server";
import { comTratamentoDeErro } from "@/lib/api-erro";
import { autorizar, registrarAuditoria } from "@/lib/acesso";
import { prisma } from "@/lib/prisma";
import { regenerarTokenMesa, tokenAtualDaMesa, urlDoCardapio } from "@/lib/cardapio/tokens";

/**
 * Origem pública usada para montar o link/QR do cardápio da mesa.
 *
 * Prioridade (primeiro que existir vence):
 *   1. NEXT_PUBLIC_CARDAPIO_BASE_URL — URL específica do cardápio. Permite,
 *      em desenvolvimento, apontar para o IPv4 da rede local do notebook
 *      (ex.: http://192.168.0.10:3000) para o QR abrir no celular na mesma
 *      rede Wi-Fi — sem hardcodar localhost nem versionar IP local (a URL
 *      fica em variável de ambiente, fora do Git).
 *   2. NEXT_PUBLIC_APP_URL — URL pública oficial configurada.
 *   3. APP_URL — URL pública do lado do servidor.
 *   4. Origem da requisição (fallback seguro: nunca localhost hardcoded).
 */
function baseUrl(req: NextRequest): string {
  const opcoes = [
    process.env.NEXT_PUBLIC_CARDAPIO_BASE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
    new URL(req.url).origin,
  ];
  for (const opcao of opcoes) {
    if (opcao && /^https?:\/\/.+/i.test(opcao.trim())) {
      return opcao.trim().replace(/\/+$/, "");
    }
  }
  return new URL(req.url).origin;
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
