import { NextRequest, NextResponse } from "next/server";
import { comTratamentoDeErro } from "@/lib/api-erro";
import { autorizar } from "@/lib/acesso";
import { listarAguardandoAprovacao } from "@/lib/pedidos/aprovar-rejeitar-pedido";

/**
 * GET /api/pedidos/aguardando
 *
 * Fila do salão: pedidos com `producao = "aguardando_aprovacao"` desta
 * empresa. `empresaId` vem sempre de `autorizar()`, nunca de query string.
 */
export const GET = comTratamentoDeErro("pedidos.aguardando.GET", async (_req: NextRequest) => {
  const acesso = await autorizar("salao");
  if (!acesso.ok) return acesso.resposta;
  return NextResponse.json({ pedidos: await listarAguardandoAprovacao(acesso.empresaId) });
});
