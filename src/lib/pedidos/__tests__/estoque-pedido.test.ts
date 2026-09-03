import { describe, it, expect, vi, beforeEach } from "vitest";
import { debitarInsumosDoPedido, EstoqueInsuficienteError } from "@/lib/pedidos/estoque-pedido";

function makeTx(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    produtoInsumo: {
      findMany: vi.fn(),
    },
    estoqueProduto: {
      updateMany: vi.fn(),
      findFirst: vi.fn(),
    },
    movimentacaoEstoque: {
      create: vi.fn(),
    },
    ...overrides,
  } as any;
}

describe("debitarInsumosDoPedido", () => {
  it("debita e registra movimentação quando há estoque", async () => {
    const tx = makeTx();
    tx.produtoInsumo.findMany.mockResolvedValue([
      {
        estoqueProdutoId: "e1",
        quantidadeNecessaria: 100,
        estoqueProduto: { id: "e1", nome: "Queijo", unidade: "g", ativo: true },
      },
    ]);
    tx.estoqueProduto.updateMany.mockResolvedValue({ count: 1 });
    tx.movimentacaoEstoque.create.mockResolvedValue({});

    await debitarInsumosDoPedido(tx, "emp1", [{ produtoId: "p1", quantidade: 2, nome: "Pizza" }]);

    expect(tx.estoqueProduto.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "e1", quantidade: { gte: 200 } }),
        data: { quantidade: { decrement: 200 } },
      })
    );
    expect(tx.movimentacaoEstoque.create).toHaveBeenCalled();
  });

  it("falha sem debitar parcialmente quando estoque insuficiente", async () => {
    const tx = makeTx();
    tx.produtoInsumo.findMany.mockResolvedValue([
      {
        estoqueProdutoId: "e1",
        quantidadeNecessaria: 100,
        estoqueProduto: { id: "e1", nome: "Queijo", unidade: "g", ativo: true },
      },
    ]);
    tx.estoqueProduto.updateMany.mockResolvedValue({ count: 0 });
    tx.estoqueProduto.findFirst.mockResolvedValue({ quantidade: 50, nome: "Queijo", unidade: "g" });

    await expect(
      debitarInsumosDoPedido(tx, "emp1", [{ produtoId: "p1", quantidade: 1 }])
    ).rejects.toBeInstanceOf(EstoqueInsuficienteError);
    expect(tx.movimentacaoEstoque.create).not.toHaveBeenCalled();
  });
});
