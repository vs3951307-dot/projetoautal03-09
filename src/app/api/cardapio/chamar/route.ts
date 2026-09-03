import { NextRequest, NextResponse } from "next/server";
import { comTratamentoDeErro } from "@/lib/api-erro";
import { abrirMesa } from "@/app/api/cardapio/_comum";
import { chamarGarcom } from "@/lib/cardapio/adapters";

/** POST /api/cardapio/chamar — { slug, token, tipo: "garcom" | "conta" } */
export const POST = comTratamentoDeErro("cardapio.chamar.POST", async (req: NextRequest) => {
  const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const portaria = await abrirMesa(req, corpo, { maximo: 6, janelaMs: 60_000 });
  if (!portaria.ok) return portaria.resposta;

  const tipo = corpo.tipo === "conta" ? "conta" : "garcom";
  await chamarGarcom(portaria.mesa, tipo);
  return NextResponse.json({
    ok: true,
    mensagem: tipo === "conta" ? "Pedimos a conta. Já vem!" : "O garçom foi chamado.",
  });
});
