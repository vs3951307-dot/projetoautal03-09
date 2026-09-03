import { NextRequest, NextResponse } from "next/server";
import { comTratamentoDeErro } from "@/lib/api-erro";
import { abrirMesa } from "@/app/api/cardapio/_comum";
import { criarPedidoDaMesa, type ItemDoCliente } from "@/lib/cardapio/adapters";

/**
 * POST /api/cardapio/pedidos
 *
 * O corpo NÃO carrega preço, total, mesaId nem empresaId. Só o token, o
 * nome de quem está pedindo, a chave de idempotência e os itens. Tudo o
 * mais é decidido no servidor.
 */
export const POST = comTratamentoDeErro("cardapio.pedidos.POST", async (req: NextRequest) => {
  const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const portaria = await abrirMesa(req, corpo, { maximo: 10, janelaMs: 60_000 });
  if (!portaria.ok) return portaria.resposta;

  const idempotencyKey = typeof corpo.idempotencyKey === "string" ? corpo.idempotencyKey : "";
  if (!idempotencyKey) {
    return NextResponse.json({ erro: "idempotencyKey é obrigatória." }, { status: 400 });
  }
  const nomeCliente = typeof corpo.nomeCliente === "string" ? corpo.nomeCliente.trim() : "";
  if (nomeCliente.length < 2) {
    return NextResponse.json({ erro: "Diga seu nome para identificar o pedido." }, { status: 400 });
  }

  const itens: ItemDoCliente[] = Array.isArray(corpo.itens)
    ? (corpo.itens as Record<string, unknown>[]).map((i) => ({
        produtoId: String(i.produtoId ?? ""),
        quantidade: Number(i.quantidade ?? 1),
        tamanho: typeof i.tamanho === "string" ? i.tamanho : null,
        sabores: Array.isArray(i.sabores) ? i.sabores.map(String) : [],
        adicionais: Array.isArray(i.adicionais)
          ? (i.adicionais as Record<string, unknown>[]).map((a) => ({ nome: String(a.nome ?? "") }))
          : [],
        observacao: typeof i.observacao === "string" ? i.observacao.slice(0, 200) : null,
      }))
    : [];

  const r = await criarPedidoDaMesa(portaria.mesa, {
    nomeCliente,
    idempotencyKey,
    itens,
    observacao: typeof corpo.observacao === "string" ? corpo.observacao.slice(0, 300) : null,
  });

  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json(
    {
      pedidoId: r.pedidoId,
      numero: r.numero,
      total: r.total,
      aguardandoAprovacao: r.aguardandoAprovacao,
      mensagem: r.aguardandoAprovacao
        ? "Pedido enviado! O garçom vai confirmar em instantes."
        : "Pedido enviado para a cozinha!",
    },
    { status: r.status }
  );
});
