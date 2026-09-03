import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    produtoInsumo: { findMany: (...args: unknown[]) => findMany(...args) },
  },
}));

const { verificarDisponibilidade } = await import("@/lib/atendente/disponibilidade");

describe("verificarDisponibilidade com quantidadeNecessaria", () => {
  beforeEach(() => {
    findMany.mockReset();
  });

  it("bloqueia quando estoque < quantidadeNecessaria * quantidade", async () => {
    findMany.mockResolvedValue([
      {
        quantidadeNecessaria: 300,
        estoqueProduto: {
          id: "e1",
          nome: "Queijo",
          quantidade: 200,
          minimo: 0,
          unidade: "g",
          ativo: true,
        },
      },
    ]);
    const r = await verificarDisponibilidade("emp1", "prod1", 1);
    expect(r.disponivel).toBe(false);
    expect(r.motivo).toMatch(/Queijo/i);
  });

  it("permite quando estoque é exatamente o necessário", async () => {
    findMany.mockResolvedValue([
      {
        quantidadeNecessaria: 300,
        estoqueProduto: {
          id: "e1",
          nome: "Queijo",
          quantidade: 300,
          minimo: 0,
          unidade: "g",
          ativo: true,
        },
      },
    ]);
    const r = await verificarDisponibilidade("emp1", "prod1", 1);
    expect(r.disponivel).toBe(true);
  });

  it("multiplica necessidade pela quantidade do pedido", async () => {
    findMany.mockResolvedValue([
      {
        quantidadeNecessaria: 100,
        estoqueProduto: {
          id: "e1",
          nome: "Molho",
          quantidade: 150,
          minimo: 0,
          unidade: "g",
          ativo: true,
        },
      },
    ]);
    const r1 = await verificarDisponibilidade("emp1", "prod1", 1);
    expect(r1.disponivel).toBe(true);
    const r2 = await verificarDisponibilidade("emp1", "prod1", 2);
    expect(r2.disponivel).toBe(false);
  });

  it("produto sem ficha técnica continua disponível", async () => {
    findMany.mockResolvedValue([]);
    const r = await verificarDisponibilidade("emp1", "prod1", 5);
    expect(r.disponivel).toBe(true);
  });
});
