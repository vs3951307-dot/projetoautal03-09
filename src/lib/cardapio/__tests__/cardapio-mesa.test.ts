/**
 * Cardápio digital por mesa — testes de integração da camada de serviço.
 *
 * O que estes testes travam:
 *  - regenerar o QR invalida o link antigo;
 *  - token válido de uma empresa não abre a mesa de outra;
 *  - o cliente NUNCA envia preço, e o preço nunca sai daqui;
 *  - com aprovação manual, o pedido não vai para a cozinha;
 *  - só o adapter fala com o Prisma.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const { db, criarPedidoMock, emitirKdsMock, emitirEventoMock } = vi.hoisted(() => ({
  db: {
    empresa: { findUnique: vi.fn() },
    mesa: { findUnique: vi.fn(), updateMany: vi.fn() },
    mesaTokenAcesso: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    pedido: { findFirst: vi.fn(), update: vi.fn() },
    configuracao: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  criarPedidoMock: vi.fn(),
  emitirKdsMock: vi.fn(),
  emitirEventoMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/pedidos/criar-pedido", () => ({ criarPedido: criarPedidoMock }));
vi.mock("@/lib/kds-eventos", () => ({ emitirMudancaKds: emitirKdsMock }));
vi.mock("@/lib/eventos-tempo-real", () => ({ emitirEventoTempoReal: emitirEventoMock }));
vi.mock("@/lib/atendente/catalogo", () => ({ listarProdutosDisponiveis: vi.fn(async () => []) }));
vi.mock("@/lib/atendente/disponibilidade", () => ({
  verificarDisponibilidade: vi.fn(async () => ({ disponivel: true, motivo: null })),
}));

import { resolverTokenMesa, regenerarTokenMesa, urlDoCardapio } from "@/lib/cardapio/tokens";
import { criarPedidoDaMesa, chamarGarcom } from "@/lib/cardapio/adapters";

const EMPRESA_A = { id: "empA", nome: "Pizzaria A", slug: "pizzaria-a", status: "ativa" };
const EMPRESA_B = { id: "empB", nome: "Pizzaria B", slug: "pizzaria-b", status: "ativa" };
const MESA_A = { id: 10, numero: 5, empresaId: "empA" };

const MESA_RESOLVIDA = {
  empresaId: "empA",
  empresaNome: "Pizzaria A",
  empresaSlug: "pizzaria-a",
  empresaLogoUrl: null,
  mesaId: 10,
  mesaNumero: 5,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.empresa.findUnique.mockImplementation(async (args: { where: { slug?: string; id?: string } }) => {
    if (args.where.slug === EMPRESA_A.slug || args.where.id === EMPRESA_A.id) return EMPRESA_A;
    if (args.where.slug === EMPRESA_B.slug || args.where.id === EMPRESA_B.id) return EMPRESA_B;
    return null;
  });
  db.mesaTokenAcesso.findUnique.mockResolvedValue(null);
  db.configuracao.findUnique.mockResolvedValue(null);
  db.mesa.updateMany.mockResolvedValue({ count: 1 });
  db.pedido.update.mockResolvedValue({});
  db.$transaction.mockResolvedValue([{}, {}]);
});

describe("token da mesa", () => {
  it("abre a mesa com token ativo", async () => {
    db.mesaTokenAcesso.findUnique.mockResolvedValue({ ativo: true, mesa: MESA_A });
    await expect(resolverTokenMesa("pizzaria-a", "tok-1")).resolves.toMatchObject({
      empresaId: "empA",
      mesaNumero: 5,
    });
  });

  it("token revogado (QR regenerado) não abre mais", async () => {
    db.mesaTokenAcesso.findUnique.mockResolvedValue({ ativo: false, mesa: MESA_A });
    await expect(resolverTokenMesa("pizzaria-a", "tok-antigo")).resolves.toBeNull();
  });

  it("regenerar revoga os anteriores e cria o novo na MESMA transação", async () => {
    db.mesa.findUnique.mockResolvedValue(MESA_A);
    await regenerarTokenMesa("empA", 5, "user-1");

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.mesaTokenAcesso.updateMany).toHaveBeenCalledWith({
      where: { empresaId: "empA", mesaId: 10, ativo: true },
      data: { ativo: false, revogadoEm: expect.any(Date) },
    });
    expect(db.mesaTokenAcesso.create).toHaveBeenCalled();
  });

  it("cada token gerado é diferente do anterior", async () => {
    db.mesa.findUnique.mockResolvedValue(MESA_A);
    const a = await regenerarTokenMesa("empA", 5);
    const b = await regenerarTokenMesa("empA", 5);
    expect(a!.token).not.toBe(b!.token);
    expect(a!.token.length).toBeGreaterThanOrEqual(30);
  });

  it("token real da empresa A não abre na URL da empresa B", async () => {
    // A busca é escopada por empresaId, então na empresa B não existe.
    db.mesaTokenAcesso.findUnique.mockResolvedValue(null);
    await expect(resolverTokenMesa("pizzaria-b", "tok-da-A")).resolves.toBeNull();
    expect(db.mesaTokenAcesso.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { empresaId_token: { empresaId: "empB", token: "tok-da-A" } } })
    );
  });

  it("mesa de outra empresa é recusada mesmo com token encontrado", async () => {
    db.mesaTokenAcesso.findUnique.mockResolvedValue({
      ativo: true,
      mesa: { id: 99, numero: 1, empresaId: "empB" },
    });
    await expect(resolverTokenMesa("pizzaria-a", "tok-1")).resolves.toBeNull();
  });

  it("empresa bloqueada não serve cardápio", async () => {
    db.empresa.findUnique.mockResolvedValue({ ...EMPRESA_A, status: "bloqueada" });
    await expect(resolverTokenMesa("pizzaria-a", "tok-1")).resolves.toBeNull();
  });

  it("a URL do QR carrega slug e token", () => {
    expect(urlDoCardapio("https://app.exemplo.com/", "pizzaria-a", "abc")).toBe(
      "https://app.exemplo.com/cardapio/pizzaria-a/mesa/abc"
    );
  });
});

describe("pedido feito pela mesa", () => {
  function empresaComCardapio(aprovacaoManual: boolean) {
    db.empresa.findUnique.mockResolvedValue({ ...EMPRESA_A, modulos: '["pdv","mesas"]', plano: "completo" });
    db.configuracao.findUnique.mockResolvedValue({
      valor: JSON.stringify({ ativo: true, aprovacaoManual }),
    });
  }

  it("o preço NUNCA é enviado pelo cliente nem repassado ao serviço", async () => {
    empresaComCardapio(false);
    criarPedidoMock.mockResolvedValue({
      ok: true,
      status: 201,
      idempotente: false,
      pedido: { id: "ped1", numero: 42, total: 89.9 },
    });

    await criarPedidoDaMesa(MESA_RESOLVIDA, {
      nomeCliente: "Victor",
      idempotencyKey: "chave-1",
      // Mesmo que alguém injete preço no corpo, ele não chega ao serviço.
      itens: [{ produtoId: "p1", quantidade: 2, preco: 0.01 } as never],
    });

    const corpo = criarPedidoMock.mock.calls[0][2];
    expect(corpo.itens[0]).not.toHaveProperty("preco");
    expect(corpo.itens[0]).not.toHaveProperty("precoUnit");
    expect(corpo).not.toHaveProperty("total");
    // A empresa e a mesa vêm do TOKEN, não do corpo.
    expect(criarPedidoMock.mock.calls[0][0]).toBe("empA");
    expect(corpo.mesaId).toBe(5);
    expect(corpo.canal).toBe("salao");
  });

  it("com aprovação manual, o pedido NÃO vai para a cozinha", async () => {
    empresaComCardapio(true);
    criarPedidoMock.mockResolvedValue({
      ok: true,
      status: 201,
      idempotente: false,
      pedido: { id: "ped1", numero: 42, total: 50 },
    });

    const r = await criarPedidoDaMesa(MESA_RESOLVIDA, {
      nomeCliente: "Victor",
      idempotencyKey: "chave-1",
      itens: [{ produtoId: "p1", quantidade: 1 }],
    });

    expect(r.aguardandoAprovacao).toBe(true);
    // ATOMICIDADE: o estado vai JUNTO na criação. Nada de criar "recebido"
    // e corrigir depois — nessa janela o KDS e a impressão já teriam pego
    // o pedido.
    expect(criarPedidoMock.mock.calls[0][2].producaoInicial).toBe("aguardando_aprovacao");
    expect(db.pedido.update).not.toHaveBeenCalled();
    expect(emitirKdsMock).not.toHaveBeenCalled();
  });

  it("sem aprovação manual, a cozinha é avisada", async () => {
    empresaComCardapio(false);
    criarPedidoMock.mockResolvedValue({
      ok: true,
      status: 201,
      idempotente: false,
      pedido: { id: "ped1", numero: 42, total: 50 },
    });

    await criarPedidoDaMesa(MESA_RESOLVIDA, {
      nomeCliente: "Victor",
      idempotencyKey: "chave-1",
      itens: [{ produtoId: "p1", quantidade: 1 }],
    });

    expect(criarPedidoMock.mock.calls[0][2].producaoInicial).toBe("recebido");
    expect(db.pedido.update).not.toHaveBeenCalled();
    expect(emitirKdsMock).toHaveBeenCalledWith("empA");
  });

  it("reenvio da mesma chave não cria nem reemite nada", async () => {
    empresaComCardapio(false);
    criarPedidoMock.mockResolvedValue({
      ok: true,
      status: 200,
      idempotente: true,
      pedido: { id: "ped1", numero: 42, total: 50 },
    });

    const r = await criarPedidoDaMesa(MESA_RESOLVIDA, {
      nomeCliente: "Victor",
      idempotencyKey: "chave-1",
      itens: [{ produtoId: "p1", quantidade: 1 }],
    });

    expect(r.idempotente).toBe(true);
    expect(emitirKdsMock).not.toHaveBeenCalled();
    expect(db.mesa.updateMany).not.toHaveBeenCalled();
  });

  it("carrinho vazio é recusado antes de tocar no serviço de pedido", async () => {
    empresaComCardapio(false);
    const r = await criarPedidoDaMesa(MESA_RESOLVIDA, {
      nomeCliente: "Victor",
      idempotencyKey: "chave-1",
      itens: [],
    });
    expect(r.ok).toBe(false);
    expect(criarPedidoMock).not.toHaveBeenCalled();
  });
});

describe("chamar garçom", () => {
  it("usa Mesa.status e escopa por empresa", async () => {
    await chamarGarcom(MESA_RESOLVIDA, "conta");
    expect(db.mesa.updateMany).toHaveBeenCalledWith({
      where: { id: 10, empresaId: "empA" },
      data: { status: "conta", abertaEm: undefined },
    });
  });
});

describe("isolamento da camada", () => {
  /** Lista recursiva de arquivos .ts/.tsx de uma pasta. */
  function arquivos(dir: string): string[] {
    const saida: string[] = [];
    for (const nome of readdirSync(dir)) {
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) saida.push(...arquivos(caminho));
      else if (/\.tsx?$/.test(nome)) saida.push(caminho);
    }
    return saida;
  }

  it("nenhum componente ou rota do cardápio importa o Prisma direto", () => {
    const pastas = ["src/app/cardapio", "src/app/api/cardapio", "src/components/cardapio"];
    const permitidos = new Set(["src/app/api/cardapio/mesas/[numero]/token/route.ts"]);
    const infratores: string[] = [];
    for (const pasta of pastas) {
      for (const arquivo of arquivos(pasta)) {
        const relativo = arquivo.replace(/\\/g, "/");
        if (permitidos.has(relativo)) continue;
        if (/from "@\/lib\/prisma"/.test(readFileSync(arquivo, "utf-8"))) infratores.push(relativo);
      }
    }
    expect(infratores).toEqual([]);
  });
});
