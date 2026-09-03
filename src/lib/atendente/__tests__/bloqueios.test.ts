/**
 * Bloqueio operacional temporário: "hoje não temos X".
 *
 * O que estes testes travam:
 *  - indisponibilizar NUNCA altera o cadastro (`Produto.ativo`);
 *  - a validade é interpretada e persistida (hoje / N horas / até avisar);
 *  - o bloqueio vencido some sozinho na leitura seguinte;
 *  - "voltou" libera na hora;
 *  - o atendente enxerga a mudança imediatamente, pelo mesmo catálogo.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    configuracao: { findUnique: vi.fn(), upsert: vi.fn() },
    produto: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    sabor: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/acesso", () => ({ registrarAuditoria: vi.fn(async () => {}) }));
vi.mock("@/lib/delivery", () => ({
  lerConfigTaxaEntrega: vi.fn(async () => ({})),
  calcularTaxaEntrega: vi.fn(() => ({ taxa: 0 })),
}));

import {
  interpretarValidade,
  fimDoDiaOperacional,
  lerBloqueios,
  registrarBloqueio,
  removerBloqueio,
  CHAVE_BLOQUEIOS,
} from "@/lib/atendente/bloqueios";
import { definirDisponibilidadeProduto, listarIndisponiveis } from "@/lib/copiloto/tools-estoque";
import { listarProdutosDisponiveis } from "@/lib/atendente/catalogo";

const USUARIO = { id: "u1", nome: "Gerente", permissoes: [] } as never;

/** `Configuracao` de mentira que se comporta como o banco (persiste entre chamadas). */
let armazenado: string | null;

beforeEach(() => {
  vi.clearAllMocks();
  armazenado = null;
  db.configuracao.findUnique.mockImplementation(async () =>
    armazenado === null ? null : { empresaId: "emp1", chave: CHAVE_BLOQUEIOS, valor: armazenado }
  );
  db.configuracao.upsert.mockImplementation(async (args: { create: { valor: string }; update: { valor: string } }) => {
    armazenado = args.update.valor ?? args.create.valor;
    return {};
  });
  db.produto.findMany.mockResolvedValue([]);
  db.sabor.findMany.mockResolvedValue([]);
});

describe("interpretação da temporalidade", () => {
  const agora = new Date("2026-09-02T21:00:00.000Z"); // 18h de Brasília

  it("'hoje' vale até a virada do dia operacional, não até a meia-noite", () => {
    const { validoAte } = interpretarValidade("hoje não temos estrogonofe", agora);
    expect(validoAte).not.toBeNull();
    // 05:00 de Brasília do dia seguinte = 08:00 UTC de 03/09.
    expect(validoAte!.toISOString()).toBe("2026-09-03T08:00:00.000Z");
  });

  it("pedido feito 00h20 ainda conta como o mesmo dia de trabalho", () => {
    const madrugada = new Date("2026-09-03T03:20:00.000Z"); // 00h20 BR
    expect(fimDoDiaOperacional(madrugada).toISOString()).toBe("2026-09-03T08:00:00.000Z");
  });

  it("'por duas horas' expira em duas horas", () => {
    const { validoAte } = interpretarValidade("tira a coca por duas horas", agora);
    expect(validoAte!.getTime() - agora.getTime()).toBe(2 * 60 * 60 * 1000);
  });

  it("'até eu avisar' não expira", () => {
    expect(interpretarValidade("não vender isso até eu avisar", agora).validoAte).toBeNull();
  });

  it("sem sinal de tempo, o padrão é o fim do dia", () => {
    const { validoAte } = interpretarValidade("acabou catupiry", agora);
    expect(validoAte!.toISOString()).toBe("2026-09-03T08:00:00.000Z");
  });
});

describe("persistência e expiração", () => {
  it("bloqueio vencido some sozinho na leitura seguinte", async () => {
    await registrarBloqueio("emp1", {
      tipo: "sabor",
      id: "s2",
      nome: "Estrogonofe de Frango",
      validoAte: new Date("2026-09-03T08:00:00.000Z").toISOString(),
    });

    const antes = await lerBloqueios("emp1", new Date("2026-09-03T02:00:00.000Z"));
    expect(antes).toHaveLength(1);

    const depois = await lerBloqueios("emp1", new Date("2026-09-03T09:00:00.000Z"));
    expect(depois).toHaveLength(0);
  });

  it("bloquear o mesmo item duas vezes não duplica — substitui a validade", async () => {
    await registrarBloqueio("emp1", { tipo: "sabor", id: "s2", nome: "X", validoAte: "2026-09-03T08:00:00.000Z" });
    await registrarBloqueio("emp1", { tipo: "sabor", id: "s2", nome: "X", validoAte: null });
    const lista = await lerBloqueios("emp1");
    expect(lista).toHaveLength(1);
    expect(lista[0].validoAte).toBeNull();
  });

  it("configuração corrompida não derruba o atendimento", async () => {
    armazenado = "{ isso não é json válido";
    await expect(lerBloqueios("emp1")).resolves.toEqual([]);
  });

  it("remover devolve false quando não havia bloqueio", async () => {
    await expect(removerBloqueio("emp1", "produto", "inexistente")).resolves.toBe(false);
  });
});

describe("Central da IA → banco", () => {
  it("'hoje não temos' NÃO altera o cadastro do sabor", async () => {
    db.sabor.findMany.mockResolvedValue([{ id: "s2", nome: "Estrogonofe de Frango" }]);
    db.sabor.findFirst.mockResolvedValue({ id: "s2", nome: "Estrogonofe de Frango", ativo: true });

    const r = await definirDisponibilidadeProduto("emp1", USUARIO, {
      nomeProduto: "estrogonofe de frango",
      disponivel: false,
      validadeTexto: "hoje não temos estrogonofe de frango",
    });

    expect(r.ok).toBe(true);
    expect(r.mensagem).toMatch(/fim do dia/i);
    // O ponto central: o cadastro fica intacto.
    expect(db.sabor.update).not.toHaveBeenCalled();
    expect(db.produto.update).not.toHaveBeenCalled();
    // E o bloqueio ficou persistido com validade.
    const lista = await lerBloqueios("emp1");
    expect(lista).toEqual([expect.objectContaining({ tipo: "sabor", id: "s2", validoAte: expect.any(String) })]);
  });

  it("'voltou' libera e conserta cadastro desativado pelo comportamento antigo", async () => {
    await registrarBloqueio("emp1", { tipo: "sabor", id: "s2", nome: "Estrogonofe de Frango", validoAte: null });
    db.sabor.findMany.mockResolvedValue([{ id: "s2", nome: "Estrogonofe de Frango" }]);
    db.sabor.findFirst.mockResolvedValue({ id: "s2", nome: "Estrogonofe de Frango", ativo: false });

    const r = await definirDisponibilidadeProduto("emp1", USUARIO, {
      nomeProduto: "estrogonofe de frango",
      disponivel: true,
    });

    expect(r.ok).toBe(true);
    expect(db.sabor.update).toHaveBeenCalledWith({ where: { id: "s2" }, data: { ativo: true } });
    await expect(lerBloqueios("emp1")).resolves.toEqual([]);
  });

  it("a lista de indisponíveis mostra o bloqueio e a validade", async () => {
    await registrarBloqueio("emp1", { tipo: "produto", id: "p9", nome: "Coca-Cola 2L", validoAte: null });
    const r = await listarIndisponiveis("emp1");
    expect(r.mensagem).toMatch(/Coca-Cola 2L/);
    expect(r.mensagem).toMatch(/até você avisar/i);
  });
});

describe("Central da IA → atendente (mesma verdade, no mesmo instante)", () => {
  const PIZZA = {
    id: "p1",
    nome: "Pizza",
    descricao: "",
    preco: 45,
    emoji: "🍕",
    fotoUrl: null,
    destaque: false,
    ativo: true,
    categoria: { nome: "Pizza", ordem: 1 },
    precos: [{ tamanhoId: "t1", tamanho: { nome: "Grande" }, valor: 55 }],
    sabores: [
      { sabor: { id: "s1", nome: "Calabresa", tipo: "tradicional" } },
      { sabor: { id: "s2", nome: "Estrogonofe de Frango", tipo: "especial" } },
    ],
  };
  const COCA = {
    id: "p9",
    nome: "Coca-Cola 2L",
    descricao: "",
    preco: 12,
    emoji: "🥤",
    fotoUrl: null,
    destaque: false,
    ativo: true,
    categoria: { nome: "Bebidas", ordem: 2 },
    precos: [],
    sabores: [],
  };

  beforeEach(() => {
    db.produto.findMany.mockResolvedValue([PIZZA, COCA]);
  });

  it("sabor bloqueado desaparece do cardápio do atendente", async () => {
    const antes = await listarProdutosDisponiveis("emp1");
    expect(antes.find((p) => p.id === "p1")!.sabores.map((s) => s.nome)).toEqual([
      "Calabresa",
      "Estrogonofe de Frango",
    ]);

    await registrarBloqueio("emp1", { tipo: "sabor", id: "s2", nome: "Estrogonofe de Frango", validoAte: null });

    const depois = await listarProdutosDisponiveis("emp1");
    expect(depois.find((p) => p.id === "p1")!.sabores.map((s) => s.nome)).toEqual(["Calabresa"]);
  });

  it("produto bloqueado some inteiro", async () => {
    await registrarBloqueio("emp1", { tipo: "produto", id: "p9", nome: "Coca-Cola 2L", validoAte: null });
    const lista = await listarProdutosDisponiveis("emp1");
    expect(lista.map((p) => p.id)).toEqual(["p1"]);
  });

  it("pizza sem NENHUM sabor liberado não é oferecida", async () => {
    await registrarBloqueio("emp1", { tipo: "sabor", id: "s1", nome: "Calabresa", validoAte: null });
    await registrarBloqueio("emp1", { tipo: "sabor", id: "s2", nome: "Estrogonofe de Frango", validoAte: null });
    const lista = await listarProdutosDisponiveis("emp1");
    expect(lista.map((p) => p.id)).toEqual(["p9"]);
  });

  it("depois de expirar, o item volta sozinho para o cardápio", async () => {
    await registrarBloqueio("emp1", {
      tipo: "produto",
      id: "p9",
      nome: "Coca-Cola 2L",
      validoAte: new Date(Date.now() - 1000).toISOString(),
    });
    const lista = await listarProdutosDisponiveis("emp1");
    expect(lista.map((p) => p.id)).toContain("p9");
  });
});
