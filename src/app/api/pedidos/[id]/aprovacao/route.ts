import { NextRequest, NextResponse } from "next/server";
import { comTratamentoDeErro } from "@/lib/api-erro";
import { autorizar } from "@/lib/acesso";
import { aprovarOuRejeitarPedido } from "@/lib/pedidos/aprovar-rejeitar-pedido";

/**
 * GET  /api/pedidos/aguardando  → ver `../aguardando/route.ts`
 * POST /api/pedidos/:id/aprovacao
 *
 * Body: { acao: "aprovar" } | { acao: "rejeitar", motivo: "..." }
 *
 * `empresaId` NUNCA vem do corpo: sai de `autorizar()`, que é o único
 * lugar que sabe qual tenant está autenticado. Aceitar `empresaId` do
 * cliente seria um caminho direto para aprovar pedido de outra empresa.
 */
export const POST = comTratamentoDeErro(
  "pedidos.aprovacao.POST",
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const acesso = await autorizar("salao");
    if (!acesso.ok) return acesso.resposta;

    const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const acao = corpo.acao === "rejeitar" ? "rejeitar" : corpo.acao === "aprovar" ? "aprovar" : null;
    if (!acao) {
      return NextResponse.json(
        { ok: false, codigo: "VALIDACAO", mensagem: 'Informe acao: "aprovar" ou "rejeitar".' },
        { status: 400 }
      );
    }

    const resultado = await aprovarOuRejeitarPedido({
      empresaId: acesso.empresaId,
      pedidoId: params.id,
      acao,
      motivo: typeof corpo.motivo === "string" ? corpo.motivo : undefined,
      usuario: acesso.usuario ? { id: acesso.usuario.id, nome: acesso.usuario.nome } : undefined,
    });

    if (!resultado.ok) {
      const status =
        resultado.codigo === "PEDIDO_NAO_ENCONTRADO"
          ? 404
          : resultado.codigo === "CONFLITO"
            ? 409
            : 400;
      return NextResponse.json(resultado, { status });
    }
    return NextResponse.json(resultado);
  }
);
