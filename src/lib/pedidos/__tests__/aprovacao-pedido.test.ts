import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { criarPedido } from "@/lib/pedidos/criar-pedido";
import { novaChaveIdempotencia } from "@/lib/idempotencia";
import {
  comoEmpresa,
  empresasDoSeed,
  prismaNoSchema,
  usuarioDeTeste,
  type EmpresaDeTeste,
} from "@/lib/__tests__/ajuda-banco-de-teste";

/**
 * Aprovação de pedido do cardápio digital — contra PostgreSQL real.
 *
 * A afirmação a provar é: um pedido feito pelo cliente na mesa só chega à
 * cozinha depois que uma pessoa autorizada aprova. Isso não dá para provar
 * com mock do banco — o que garante a transição única é o `updateMany` com
 * o estado anterior no `where`. Aqui o pedido é criado pela MESMA função
 * que a rota usa e o estado é lido de volta do banco.
 *
 * Os efeitos de cozinha (KDS e impressão) são mockados de propósito: o que
 * se quer provar é QUANDO eles são chamados, não o que imprimem.
 */

const kds = vi.hoisted(() => ({ emitir: vi.fn() }));
const impressao = vi.hoisted(() => ({ enfileirar: vi.fn(async () => {}) }));

vi.mock("@/lib/kds-eventos", () => ({ emitirMudancaKds: kds.emitir }));
// Mock PARCIAL: outros módulos importam mais coisas de `@/lib/impressao`.
// Substituir o módulo inteiro quebraria quem não é alvo deste teste.
vi.mock("@/lib/impressao", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/impressao")>()),
  enfileirarAutomatica: impressao.enfileirar,
  gerarConteudoPedido: vi.fn(async () => "conteudo"),
  lerImpressoras: vi.fn(async () => []),
}));

const { aprovarOuRejeitarPedido, listarAguardandoAprovacao } = await import(
  "@/lib/pedidos/aprovar-rejeitar-pedido"
);

let empresa: EmpresaDeTeste;
let db: PrismaClient;
let produto: { id: string; nome: string; preco: number };
const criados: string[] = [];

async function novoPedidoAguardando() {
  const r = await comoEmpresa(empresa, () =>
    criarPedido(empresa.id, usuarioDeTeste(), {
      canal: "balcao",
      idempotencyKey: novaChaveIdempotencia(),
      producaoInicial: "aguardando_aprovacao",
      itens: [{ produtoId: produto.id, nome: produto.nome, quantidade: 1 }],
    })
  );
  if (!r.ok) throw new Error(`Falha ao preparar pedido: ${r.erro}`);
  criados.push(r.pedido.id);
  return r.pedido;
}

beforeAll(async () => {
  const { a } = await empresasDoSeed();
  empresa = a;
  db = prismaNoSchema(a.schemaBanco!);
  const encontrado = await db.produto.findFirst({
    where: { empresaId: a.id, sabores: { none: {} }, ativo: true },
    select: { id: true, nome: true, preco: true },
    orderBy: { nome: "asc" },
  });
  if (!encontrado) throw new Error("Seed sem produto simples.");
  produto = encontrado;
});

beforeEach(() => {
  kds.emitir.mockClear();
  impressao.enfileirar.mockClear();
});

afterAll(async () => {
  if (criados.length > 0) {
    await db.itemPedido.deleteMany({ where: { pedidoId: { in: criados } } });
    await db.pedido.deleteMany({ where: { id: { in: criados } } });
  }
  await db.$disconnect();
});

describe("aprovar", () => {
  it("leva o pedido para produção e só ENTÃO chama cozinha e impressão", async () => {
    const pedido = await novoPedidoAguardando();
    // Nada de cozinha enquanto aguarda.
    expect(kds.emitir).not.toHaveBeenCalled();
    expect(impressao.enfileirar).not.toHaveBeenCalled();

    const r = await comoEmpresa(empresa, () =>
      aprovarOuRejeitarPedido({
        empresaId: empresa.id,
        pedidoId: pedido.id,
        acao: "aprovar",
        usuario: { id: "u1", nome: "Gerente" },
      })
    );

    expect(r.ok).toBe(true);
    const noBanco = await db.pedido.findUnique({
      where: { id: pedido.id },
      select: { producao: true, status: true },
    });
    expect(noBanco?.producao).toBe("recebido");
    expect(noBanco?.status).toBe("andamento");
    expect(kds.emitir).toHaveBeenCalledWith(empresa.id);
    expect(impressao.enfileirar).toHaveBeenCalled();
  });

  it("aprovar um pedido que já está em produção devolve ESTADO_INVALIDO", async () => {
    const pedido = await novoPedidoAguardando();
    await comoEmpresa(empresa, () =>
      aprovarOuRejeitarPedido({ empresaId: empresa.id, pedidoId: pedido.id, acao: "aprovar" })
    );
    kds.emitir.mockClear();

    const segunda = await comoEmpresa(empresa, () =>
      aprovarOuRejeitarPedido({ empresaId: empresa.id, pedidoId: pedido.id, acao: "aprovar" })
    );
    expect(segunda.ok).toBe(false);
    if (segunda.ok) return;
    expect(segunda.codigo).toBe("ESTADO_INVALIDO");
    // E, principalmente: a cozinha NÃO é avisada duas vezes.
    expect(kds.emitir).not.toHaveBeenCalled();
  });

  it("duas aprovações simultâneas: uma vence, a cozinha é avisada uma vez", async () => {
    const pedido = await novoPedidoAguardando();
    const [a, b] = await comoEmpresa(empresa, () =>
      Promise.all([
        aprovarOuRejeitarPedido({ empresaId: empresa.id, pedidoId: pedido.id, acao: "aprovar" }),
        aprovarOuRejeitarPedido({ empresaId: empresa.id, pedidoId: pedido.id, acao: "aprovar" }),
      ])
    );
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(kds.emitir).toHaveBeenCalledTimes(1);
  });
});

describe("rejeitar", () => {
  it("sem motivo é recusado antes de tocar no banco", async () => {
    const pedido = await novoPedidoAguardando();
    const r = await comoEmpresa(empresa, () =>
      aprovarOuRejeitarPedido({ empresaId: empresa.id, pedidoId: pedido.id, acao: "rejeitar" })
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.codigo).toBe("MOTIVO_OBRIGATORIO");
    const noBanco = await db.pedido.findUnique({
      where: { id: pedido.id },
      select: { producao: true },
    });
    expect(noBanco?.producao).toBe("aguardando_aprovacao");
  });

  it("com motivo cancela o pedido e NÃO chama a cozinha", async () => {
    const pedido = await novoPedidoAguardando();
    const r = await comoEmpresa(empresa, () =>
      aprovarOuRejeitarPedido({
        empresaId: empresa.id,
        pedidoId: pedido.id,
        acao: "rejeitar",
        motivo: "Mesa desocupou antes de confirmar",
      })
    );
    expect(r.ok).toBe(true);
    const noBanco = await db.pedido.findUnique({
      where: { id: pedido.id },
      select: { producao: true, status: true },
    });
    expect(noBanco?.status).toBe("cancelado");
    expect(noBanco?.producao).toBe("finalizado");
    expect(kds.emitir).not.toHaveBeenCalled();
    expect(impressao.enfileirar).not.toHaveBeenCalled();
  });
});

describe("liberação de mesa na rejeição (item 4)", () => {
  it("libera a mesa quando não sobra outro pedido ativo", async () => {
    const mesa = await db.mesa.create({
      data: { empresaId: empresa.id, numero: 900 + Math.floor(Math.random() * 1000), status: "pedido_enviado" },
    });
    const r = await comoEmpresa(empresa, () =>
      criarPedido(empresa.id, usuarioDeTeste(), {
        canal: "salao",
        mesaId: mesa.numero,
        idempotencyKey: novaChaveIdempotencia(),
        producaoInicial: "aguardando_aprovacao",
        itens: [{ produtoId: produto.id, nome: produto.nome, quantidade: 1 }],
      })
    );
    if (!r.ok) throw new Error(r.erro);
    criados.push(r.pedido.id);

    await comoEmpresa(empresa, () =>
      aprovarOuRejeitarPedido({
        empresaId: empresa.id,
        pedidoId: r.pedido.id,
        acao: "rejeitar",
        motivo: "Cliente desistiu",
      })
    );

    const mesaDepois = await db.mesa.findUnique({ where: { id: mesa.id } });
    expect(mesaDepois?.status).toBe("livre");
  });

  it("NÃO libera a mesa se houver outro pedido ativo nela", async () => {
    const mesa = await db.mesa.create({
      data: { empresaId: empresa.id, numero: 900 + Math.floor(Math.random() * 1000), status: "pedido_enviado" },
    });
    const criarNaMesa = () =>
      comoEmpresa(empresa, () =>
        criarPedido(empresa.id, usuarioDeTeste(), {
          canal: "salao",
          mesaId: mesa.numero,
          idempotencyKey: novaChaveIdempotencia(),
          producaoInicial: "aguardando_aprovacao",
          itens: [{ produtoId: produto.id, nome: produto.nome, quantidade: 1 }],
        })
      );
    const p1 = await criarNaMesa();
    const p2 = await criarNaMesa();
    if (!p1.ok || !p2.ok) throw new Error("falha ao preparar pedidos");
    criados.push(p1.pedido.id, p2.pedido.id);

    // Aprova o segundo (fica ativo) e rejeita o primeiro.
    await comoEmpresa(empresa, () =>
      aprovarOuRejeitarPedido({ empresaId: empresa.id, pedidoId: p2.pedido.id, acao: "aprovar" })
    );
    await comoEmpresa(empresa, () =>
      aprovarOuRejeitarPedido({
        empresaId: empresa.id,
        pedidoId: p1.pedido.id,
        acao: "rejeitar",
        motivo: "Item indisponível",
      })
    );

    const mesaDepois = await db.mesa.findUnique({ where: { id: mesa.id } });
    expect(mesaDepois?.status).not.toBe("livre");
  });
});

describe("isolamento e listagem", () => {
  it("pedido de outra empresa não é aprovável nem visível", async () => {
    const pedido = await novoPedidoAguardando();
    const { b } = await empresasDoSeed();
    const r = await comoEmpresa(b, () =>
      aprovarOuRejeitarPedido({ empresaId: b.id, pedidoId: pedido.id, acao: "aprovar" })
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.codigo).toBe("PEDIDO_NAO_ENCONTRADO");
  });

  it("a fila do salão traz o pedido enquanto ele aguarda e some depois", async () => {
    const pedido = await novoPedidoAguardando();
    const antes = await comoEmpresa(empresa, () => listarAguardandoAprovacao(empresa.id));
    expect(antes.map((p) => p.id)).toContain(pedido.id);

    await comoEmpresa(empresa, () =>
      aprovarOuRejeitarPedido({ empresaId: empresa.id, pedidoId: pedido.id, acao: "aprovar" })
    );
    const depois = await comoEmpresa(empresa, () => listarAguardandoAprovacao(empresa.id));
    expect(depois.map((p) => p.id)).not.toContain(pedido.id);
  });
});
