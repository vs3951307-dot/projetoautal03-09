/**
 * Central da IA / Copiloto: "acabou estrogonofe" com duas variantes no
 * catálogo NÃO pode alterar nada antes de perguntar qual.
 *
 * Antes, `definirDisponibilidadeProduto` usava `findFirst` com `contains`
 * e desativava silenciosamente o primeiro registro que o banco
 * devolvesse — a loja parava de vender o sabor errado sem ninguém saber.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    produto: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    sabor: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    configuracao: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/acesso", () => ({ registrarAuditoria: vi.fn(async () => {}) }));

import { definirDisponibilidadeProduto } from "@/lib/copiloto/tools-estoque";

const USUARIO = { id: "u1", nome: "Gerente", permissoes: [] } as never;

let armazenado: string | null;

beforeEach(() => {
  vi.clearAllMocks();
  armazenado = null;
  db.produto.findMany.mockResolvedValue([]);
  db.sabor.findMany.mockResolvedValue([]);
  db.configuracao.findUnique.mockImplementation(async () =>
    armazenado === null ? null : { valor: armazenado }
  );
  db.configuracao.upsert.mockImplementation(
    async (args: { create: { valor: string }; update: { valor: string } }) => {
      armazenado = args.update.valor ?? args.create.valor;
      return {};
    }
  );
});

describe("Central da IA — desambiguação obrigatória", () => {
  it("não altera nada quando 'estrogonofe' bate em duas variantes", async () => {
    db.sabor.findMany.mockResolvedValue([
      { id: "s1", nome: "Estrogonofe de Carne" },
      { id: "s2", nome: "Estrogonofe de Frango" },
    ]);

    const r = await definirDisponibilidadeProduto("emp1", USUARIO, {
      nomeProduto: "estrogonofe",
      disponivel: false,
    });

    expect(r.ok).toBe(false);
    expect(r.mensagem).toMatch(/Estrogonofe de Carne/);
    expect(r.mensagem).toMatch(/Estrogonofe de Frango/);
    expect(db.sabor.update).not.toHaveBeenCalled();
    expect(db.produto.update).not.toHaveBeenCalled();
  });

  it("executa quando o operador especifica a variante", async () => {
    db.sabor.findMany.mockResolvedValue([{ id: "s2", nome: "Estrogonofe de Frango" }]);
    db.sabor.findFirst.mockResolvedValue({ id: "s2", nome: "Estrogonofe de Frango", ativo: true });

    const r = await definirDisponibilidadeProduto("emp1", USUARIO, {
      nomeProduto: "estrogonofe de frango",
      disponivel: false,
    });

    expect(r.ok).toBe(true);
    // Indisponibilizar virou BLOQUEIO OPERACIONAL: o cadastro fica intacto.
    expect(db.sabor.update).not.toHaveBeenCalled();
    expect(db.configuracao.upsert).toHaveBeenCalled();
    expect(armazenado).toMatch(/Estrogonofe de Frango/);
  });

  it("não inventa item quando nada bate", async () => {
    const r = await definirDisponibilidadeProduto("emp1", USUARIO, {
      nomeProduto: "sushi",
      disponivel: false,
    });
    expect(r.ok).toBe(false);
    expect(r.mensagem).toMatch(/Não encontrei/i);
    expect(db.produto.update).not.toHaveBeenCalled();
    expect(db.sabor.update).not.toHaveBeenCalled();
  });

  it("as duas consultas são sempre escopadas por empresaId", async () => {
    db.sabor.findMany.mockResolvedValue([{ id: "s1", nome: "Calabresa" }]);
    db.sabor.findFirst.mockResolvedValue({ id: "s1", nome: "Calabresa", ativo: true });
    await definirDisponibilidadeProduto("emp1", USUARIO, {
      nomeProduto: "calabresa",
      disponivel: false,
    });
    // O escopo por empresa vale para as buscas de candidatos e para o alvo.
    for (const chamada of [...db.produto.findMany.mock.calls, ...db.sabor.findMany.mock.calls]) {
      expect(chamada[0].where.empresaId).toBe("emp1");
    }
    expect(db.sabor.findFirst.mock.calls[0][0].where.empresaId).toBe("emp1");
  });
});
