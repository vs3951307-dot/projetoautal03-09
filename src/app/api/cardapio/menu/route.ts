import { NextRequest, NextResponse } from "next/server";
import { comTratamentoDeErro } from "@/lib/api-erro";
import { abrirMesa } from "@/app/api/cardapio/_comum";
import { getMenu, getComandaDaMesa, lerConfigCardapio } from "@/lib/cardapio/adapters";

// Sempre dinâmica: depende do token na query string, nunca é pré-renderizada.
export const dynamic = "force-dynamic";

/**
 * GET /api/cardapio/menu?slug=...&token=...
 *
 * Cardápio da mesa + comanda atual. Público por token, sem sessão.
 */
export const GET = comTratamentoDeErro("cardapio.menu.GET", async (req: NextRequest) => {
  const url = new URL(req.url);
  const portaria = await abrirMesa(req, {
    slug: url.searchParams.get("slug"),
    token: url.searchParams.get("token"),
  });
  if (!portaria.ok) return portaria.resposta;
  const { mesa } = portaria;

  const [categorias, comanda, config] = await Promise.all([
    getMenu(mesa.empresaId),
    getComandaDaMesa(mesa),
    lerConfigCardapio(mesa.empresaId),
  ]);

  return NextResponse.json({
    empresa: { nome: mesa.empresaNome, slug: mesa.empresaSlug },
    mesa: { numero: mesa.mesaNumero },
    aviso: config.aviso ?? null,
    aprovacaoManual: config.aprovacaoManual,
    categorias,
    comanda,
  });
});
