import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizar } from "@/lib/acesso";
import { emitirMudancaKds } from "@/lib/kds-eventos";
import { comTratamentoDeErro } from "@/lib/api-erro";
import { estornarInsumosDoPedido } from "@/lib/pedidos/estoque-pedido";

const STATUS_VALIDOS = ["andamento", "preparando", "concluido", "cancelado", "pronto", "retirado", "conta"];
const PRODUCAO_VALIDA = ["recebido", "em_preparo", "pronto", "finalizado"];
// Avanço permitido na produção: recebido → em_preparo → pronto → finalizado.
const PROXIMO_ESTAGIO: Record<string, string> = {
  recebido: "em_preparo",
  em_preparo: "pronto",
  pronto: "finalizado",
};

/**
 * Cancela um pedido devolvendo ao estoque os insumos que ainda não foram
 * consumidos — CORREÇÃO DE AUDITORIA.
 *
 * ANTES: tanto o `DELETE` quanto o `PATCH { status: "cancelado" }` faziam
 * um `update` direto no pedido. O débito de ficha técnica feito na criação
 * NUNCA era revertido, então todo pedido cancelado consumia ingredientes
 * de forma definitiva. Também não havia trava de estado: cancelar duas
 * vezes rodava a operação duas vezes.
 *
 * AGORA, tudo numa transação:
 *   1. `updateMany` com `status: { not: "cancelado" }` — quem chega em
 *      segundo lugar (duplo clique, dois caixas) altera 0 linhas e a
 *      função devolve `jaCancelado`, sem estornar nada de novo.
 *   2. O estorno só acontece se a produção ainda estava em `recebido`
 *      (cozinha não começou). Ver `estornarInsumosDoPedido`.
 */
async function cancelarPedidoComEstorno(pedidoId: string, empresaId: string) {
  return prisma.$transaction(async (tx) => {
    const atual = await tx.pedido.findFirst({
      where: { id: pedidoId, empresaId },
      select: { id: true, status: true, producao: true },
    });
    if (!atual) return { encontrado: false as const };

    const alterou = await tx.pedido.updateMany({
      where: { id: pedidoId, empresaId, status: { not: "cancelado" } },
      data: { status: "cancelado", producao: "finalizado", finalizadoEm: new Date() },
    });

    if (alterou.count === 0) {
      return { encontrado: true as const, jaCancelado: true as const, estornou: false };
    }

    // Só devolve insumos se a cozinha ainda não tinha começado a produzir.
    let estornou = false;
    if (atual.producao === "recebido") {
      const itens = await tx.itemPedido.findMany({
        where: { pedidoId },
        select: { produtoId: true, quantidade: true },
      });
      await estornarInsumosDoPedido(tx, empresaId, itens);
      estornou = true;
    }

    return { encontrado: true as const, jaCancelado: false as const, estornou };
  });
}

export const PATCH = comTratamentoDeErro("pedidos.PATCH", async (req: NextRequest, { params }: { params: { id: string } }) => {
  const acesso = await autorizar("pdv", "salao", "kds", "admin");
  if (!acesso.ok) return acesso.resposta;
  const empresaId = acesso.empresaId;

  const corpo = await req.json().catch(() => ({}));
  const producao = corpo.producao ? String(corpo.producao) : null;
  const status = corpo.status ? String(corpo.status) : null;

  const pedidoAtual = await prisma.pedido.findFirst({ where: { id: params.id, empresaId } });
  if (!pedidoAtual) {
    return NextResponse.json({ erro: "Pedido não encontrado." }, { status: 404 });
  }

  // Cozinha (KDS): controla apenas o estágio de produção, sempre em frente.
  if (acesso.usuario.papel === "COZINHA") {
    const alvo = producao ?? (status === "preparando" ? "em_preparo" : status === "pronto" ? "pronto" : null);
    if (!alvo || !PRODUCAO_VALIDA.includes(alvo)) {
      return NextResponse.json(
        { erro: "Estágio de produção inválido. Use recebido, em_preparo, pronto ou finalizado." },
        { status: 400 }
      );
    }
    if (alvo !== pedidoAtual.producao && alvo !== PROXIMO_ESTAGIO[pedidoAtual.producao]) {
      return NextResponse.json(
        { erro: `A produção só avança em ordem: de ${pedidoAtual.producao} para ${PROXIMO_ESTAGIO[pedidoAtual.producao] ?? "finalizado"}.` },
        { status: 409 }
      );
    }

    const dados: Record<string, unknown> = { producao: alvo };
    if (alvo === "em_preparo") dados.preparoIniciadoEm = pedidoAtual.preparoIniciadoEm ?? new Date();
    if (alvo === "pronto") dados.prontoEm = pedidoAtual.prontoEm ?? new Date();
    const pedido = await prisma.pedido.update({ where: { id: pedidoAtual.id }, data: dados });
    emitirMudancaKds(empresaId);
    return NextResponse.json({ ok: true, pedido: { id: pedido.id, producao: pedido.producao } });
  }

  // Demais papéis (caixa/admin/garçom): status negocial; a produção
  // acompanha — pedido concluído/retirado/cancelado sai do painel.
  if (!status || !STATUS_VALIDOS.includes(status)) {
    return NextResponse.json({ erro: "Status inválido." }, { status: 400 });
  }

  // Cancelamento tem caminho próprio: precisa devolver estoque e ser
  // idempotente. Antes caía no `update` genérico abaixo e perdia insumos.
  if (status === "cancelado") {
    const r = await cancelarPedidoComEstorno(pedidoAtual.id, empresaId);
    if (!r.encontrado) {
      return NextResponse.json({ erro: "Pedido não encontrado." }, { status: 404 });
    }
    if (pedidoAtual.producao !== "finalizado") emitirMudancaKds(empresaId);
    return NextResponse.json({
      ok: true,
      pedido: { id: pedidoAtual.id, status: "cancelado", producao: "finalizado" },
      jaCancelado: r.jaCancelado,
      estoqueEstornado: r.estornou,
    });
  }

  // Um pedido já cancelado não volta a ficar aberto: sem esta trava, um
  // PATCH podia reabrir para "andamento" um pedido cancelado (e já
  // estornado), gerando pedido ativo sem lastro de estoque.
  if (pedidoAtual.status === "cancelado") {
    return NextResponse.json(
      { erro: "Este pedido está cancelado e não pode ser reaberto. Crie um novo pedido." },
      { status: 409 }
    );
  }

  const dados: Record<string, unknown> = { status };
  if (["concluido", "retirado"].includes(status)) {
    dados.producao = "finalizado";
    dados.finalizadoEm = new Date();
  } else if (status === "pronto" && pedidoAtual.producao === "recebido") {
    dados.producao = "pronto";
    dados.prontoEm = new Date();
  }
  const producaoAntes = pedidoAtual.producao;
  const pedido = await prisma.pedido.update({ where: { id: pedidoAtual.id }, data: dados });
  if (pedido.producao !== producaoAntes) emitirMudancaKds(empresaId);
  return NextResponse.json({ ok: true, pedido: { id: pedido.id, status: pedido.status, producao: pedido.producao } });
});

/** Cancela o pedido (mantém o registro, muda o status e sai do KDS). */
export const DELETE = comTratamentoDeErro("pedidos.DELETE", async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const acesso = await autorizar("pdv", "salao", "admin");
  if (!acesso.ok) return acesso.resposta;
  const empresaId = acesso.empresaId;

  const r = await cancelarPedidoComEstorno(params.id, empresaId);
  if (!r.encontrado) {
    return NextResponse.json({ erro: "Pedido não encontrado." }, { status: 404 });
  }
  emitirMudancaKds(empresaId);
  return NextResponse.json({
    ok: true,
    pedido: { id: params.id, status: "cancelado", producao: "finalizado" },
    jaCancelado: r.jaCancelado,
    estoqueEstornado: r.estornou,
  });
});
