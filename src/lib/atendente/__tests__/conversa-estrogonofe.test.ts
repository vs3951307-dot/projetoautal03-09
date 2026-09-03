/**
 * Teste de CONVERSA pelo pipeline real (`receberMensagemWhatsApp`) —
 * o mesmo ponto de entrada usado pelo webhook do WhatsApp e pelo
 * simulador. O estado é persistido entre as mensagens como no banco.
 *
 * Reproduz a conversa que quebrou em produção:
 *
 *   "boa noite" -> "gostaria de fazer um pedido"
 *   -> "pizza calabresa metade strogonofe"
 *
 * Antes: o sistema respondia "Prazer, Pizza Calabresa e Estrogonofe de
 * Carne! O que você gostaria de pedir?" — confundia produto com nome,
 * escolhia a variante sozinho e repetia a pergunta anterior.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from "vitest";

const SABORES = [
  { nome: "Calabresa", tipo: "tradicional" },
  { nome: "Estrogonofe de Carne", tipo: "especial" },
  { nome: "Estrogonofe de Frango", tipo: "especial" },
];

const PIZZA = {
  id: "p1",
  nome: "Pizza",
  precoBase: 45,
  categoria: "Pizza",
  emoji: "🍕",
  descricao: "",
  fotoUrl: null,
  destaque: false,
  disponivel: true,
  temSabores: true,
  temTamanhos: true,
  tamanhos: [
    { id: "t1", nome: "Media", valor: 45 },
    { id: "t2", nome: "Grande", valor: 55 },
  ],
  sabores: SABORES,
};

const { mockPrismaInstance } = vi.hoisted(() => ({
  mockPrismaInstance: {
    conversaWhatsApp: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    mensagemWhatsApp: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    cliente: { findFirst: vi.fn(), create: vi.fn() },
    empresa: { findUnique: vi.fn() },
    pedido: { findFirst: vi.fn() },
    eventoIA: { create: vi.fn() },
    produto: { findFirst: vi.fn(), findMany: vi.fn() },
    adicional: { findFirst: vi.fn(), findMany: vi.fn() },
    configuracao: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrismaInstance }));
vi.mock("@/lib/ai-provider", () => ({ chamarIA: vi.fn(), iaDisponivel: vi.fn(() => false) }));

vi.mock("@/lib/atendente/catalogo", () => ({
  buscarProdutos: vi.fn(async (_e: string, texto?: string) => {
    if (!texto) return [PIZZA];
    const t = texto.toLowerCase();
    return /pizza|calabresa|strogonof|estrogonof/.test(t) ? [PIZZA] : [];
  }),
  listarProdutosDisponiveis: vi.fn(async () => [PIZZA]),
  listarAdicionais: vi.fn(async () => []),
  horarioFuncionamento: vi.fn(async () => "18h às 23h"),
  nomeFantasia: vi.fn(async () => "DiskPizza Rozeno"),
  clientePorTelefone: vi.fn(async () => null),
  buscarEnderecosPorTelefone: vi.fn(async () => []),
  normalizarTelefone: vi.fn((t: string) => t.replace(/\D/g, "")),
  listarFormasPagamento: vi.fn(async () => [
    { value: "pix", label: "PIX" },
    { value: "dinheiro", label: "Dinheiro" },
  ]),
}));

// IA desligada de propósito: se o comportamento correto depender do LLM,
// o teste não prova nada sobre determinismo.
vi.mock("@/lib/atendente/ia", () => ({
  iaDisponivel: vi.fn(() => false),
  interpretarMensagem: vi.fn(async () => ""),
  embelezarResposta: vi.fn(async (p: { respostaBase: string }) => p.respostaBase),
}));

vi.mock("@/lib/atendente/persona", () => ({
  PERSONA_PADRAO: { nome: "Ana", tom: "simpatico", nicho: "generico", regras: "", horario: "", iaAtiva: true },
  carregarPersonaAtendente: vi.fn(async () => ({ nome: "Ana", tom: "simpatico", nicho: "generico", regras: "", horario: "", iaAtiva: true })),
  montarSaudacao: vi.fn(() => "Oi! Eu sou a Ana, da DiskPizza Rozeno!"),
  saudacaoInicial: vi.fn(() => "Oi! Eu sou a Ana, da DiskPizza Rozeno!"),
  RESTRICOES_FLUXO: "",
}));

vi.mock("@/lib/atendente/disponibilidade", () => ({
  verificarDisponibilidade: vi.fn(async () => ({ disponivel: true, motivo: null })),
}));
vi.mock("@/lib/atendente/permissoes", () => ({
  acaoPermitida: vi.fn(() => true),
  classificarAcao: vi.fn(() => "outro" as const),
}));
// Agente indisponível: exercita o caminho de FALLBACK, que é exatamente
// onde a conversa quebrou em produção.
vi.mock("@/lib/atendente/agente", () => ({ agenteProcessar: vi.fn(async () => null) }));
vi.mock("@/lib/atendente/deduplicador", () => ({
  eventoJaProcessado: vi.fn(() => false),
  tamanhoFilaProcessados: vi.fn(() => 0),
}));
vi.mock("@/lib/idempotencia", () => ({ novaChaveIdempotencia: vi.fn(() => "test-uuid-1234") }));
vi.mock("@/lib/delivery", () => ({
  calcularTaxaEntrega: vi.fn(() => ({ taxa: 5 })),
  lerConfigTaxaEntrega: vi.fn(async () => ({})),
  previsaoEntregaPadrao: vi.fn(async () => 40),
}));
vi.mock("@/lib/uso-ia", () => ({
  limiteIaExcedido: vi.fn(async () => false),
  registrarUsoIA: vi.fn(async () => {}),
  estimarTokens: vi.fn(() => 100),
}));
vi.mock("@/lib/atendente/eventos", () => ({
  registrarEventoIA: vi.fn(async () => {}),
  comEventoIA: vi.fn(async (_e: unknown, _t: unknown, _et: unknown, _i: unknown, fn: () => Promise<unknown>) => fn()),
}));
// O módulo real é SÍNCRONO e devolve um número. O mock antigo devolvia uma
// Promise de objeto, o que fazia o preço virar NaN silenciosamente no teste.
vi.mock("@/lib/precificacao", () => ({
  calcularPrecoItem: vi.fn((p: { precoBaseProduto: number; tamanho?: { valor: number } | null }) =>
    p.tamanho ? p.tamanho.valor : p.precoBaseProduto
  ),
}));
vi.mock("@/lib/pedidos/criar-pedido", () => ({ criarPedido: vi.fn(async () => ({ ok: true, status: 201 })) }));
vi.mock("@/lib/kds-eventos", () => ({ emitirMudancaKds: vi.fn() }));
vi.mock("@/lib/impressao", () => ({
  enfileirarAutomatica: vi.fn(async () => {}),
  gerarConteudoPedido: vi.fn(() => ""),
  referenciaPedido: vi.fn(() => ""),
  tipoParaCanalPedido: vi.fn(() => "delivery"),
  lerImpressoras: vi.fn(async () => []),
  destinoRealDoTipo: vi.fn(() => null),
}));

import { prisma } from "@/lib/prisma";
const mockPrisma = vi.mocked(prisma);

/** Conversa "de banco": o estado sobrevive de uma mensagem para a outra. */
class ConversaFalsa {
  // Conversa nova nasce em `saudacao` (ver criação em motor.ts), não em "nova":
  // "nova" é o STATUS. Com etapa errada, o switch cai no default e a primeira
  // mensagem do cliente é descartada — o teste mediria o harness, não o motor.
  etapa = "saudacao";
  status = "nova";
  estado = JSON.stringify({ itens: [], tentativas: 0, empresaId: "emp1" });
  nome: string | null = null;
  atendimentoHumano = false;

  registro() {
    return {
      id: "conv-1",
      empresaId: "emp1",
      telefone: "+5511999999999",
      etapa: this.etapa,
      status: this.status,
      nome: this.nome,
      atendimentoHumano: this.atendimentoHumano,
      criadoEm: new Date(),
      atualizadoEm: new Date(),
      ultimoAtendimento: null,
      ultimoPedido: null,
      humanaDesde: null,
      estado: this.estado,
    };
  }

  aplicar(data: Record<string, unknown>) {
    if (typeof data.etapa === "string") this.etapa = data.etapa;
    if (typeof data.status === "string") this.status = data.status;
    if (typeof data.estado === "string") this.estado = data.estado;
  }

  get dados() {
    return JSON.parse(this.estado) as Record<string, unknown>;
  }
}

let conversa: ConversaFalsa;

async function enviar(texto: string): Promise<string> {
  const { receberMensagemWhatsApp } = await import("@/lib/atendente/motor");
  const r = await receberMensagemWhatsApp("emp1", "+5511999999999", texto);
  return (r as { resposta: string }).resposta;
}

beforeEach(() => {
  vi.clearAllMocks();
  conversa = new ConversaFalsa();
  (mockPrisma.conversaWhatsApp.findUnique as unknown as MockedFunction<() => Promise<unknown>>)
    .mockImplementation(async () => conversa.registro());
  (mockPrisma.conversaWhatsApp.upsert as unknown as MockedFunction<() => Promise<unknown>>)
    .mockImplementation(async () => conversa.registro());
  (mockPrisma.conversaWhatsApp.update as unknown as MockedFunction<(a: { data: Record<string, unknown> }) => Promise<unknown>>)
    .mockImplementation(async (args: { data: Record<string, unknown> }) => {
      conversa.aplicar(args.data);
      return conversa.registro();
    });
  (mockPrisma.mensagemWhatsApp.create as unknown as MockedFunction<() => Promise<unknown>>).mockResolvedValue({});
  (mockPrisma.mensagemWhatsApp.findFirst as unknown as MockedFunction<() => Promise<unknown>>).mockResolvedValue(null);
  (mockPrisma.mensagemWhatsApp.findMany as unknown as MockedFunction<() => Promise<unknown>>).mockResolvedValue([]);
  (mockPrisma.produto.findFirst as unknown as MockedFunction<() => Promise<unknown>>).mockResolvedValue({
    id: "p1",
    nome: "Pizza",
    ativo: true,
    preco: 45,
    empresaId: "emp1",
    precos: [
      { valor: 45, tamanho: { nome: "Media", fatorPreco: 1 } },
      { valor: 55, tamanho: { nome: "Grande", fatorPreco: 1.2 } },
    ],
    sabores: SABORES.map((s) => ({ sabor: s })),
  });
  (mockPrisma.cliente.findFirst as unknown as MockedFunction<() => Promise<unknown>>).mockResolvedValue(null);
});

describe("conversa real: pizza calabresa metade strogonofe", () => {
  it("não confunde produto com nome e pergunta a variante ambígua", async () => {
    const r1 = await enviar("boa noite");
    expect(r1).not.toMatch(/prazer/i);

    const r2 = await enviar("gostaria de fazer um pedido");
    expect(r2).not.toMatch(/prazer/i);

    const r3 = await enviar("pizza calabresa metade strogonofe");

    // 1) NUNCA tratar o produto como nome do cliente.
    expect(r3).not.toMatch(/prazer/i);
    expect(conversa.dados.cliente).toMatchObject({ nome: null });

    // 2) NUNCA escolher a variante sozinho.
    expect(r3).not.toMatch(/anotado.*estrogonofe de (carne|frango)/i);

    // 3) Precisa PERGUNTAR entre as duas opções reais do catálogo.
    expect(r3).toMatch(/estrogonofe de carne/i);
    expect(r3).toMatch(/estrogonofe de frango/i);

    // 4) Precisa ter aproveitado a Calabresa que o cliente já informou.
    expect(r3).toMatch(/calabresa/i);

    // 5) NÃO pode repetir a pergunta anterior.
    expect(r3).not.toMatch(/o que você (está com vontade de pedir|gostaria de pedir)/i);
  });

  it("resolve a ambiguidade com uma resposta seca ('frango')", async () => {
    await enviar("boa noite");
    await enviar("gostaria de fazer um pedido");
    await enviar("pizza calabresa metade strogonofe");

    const r4 = await enviar("frango");

    const estado = conversa.dados as { atual?: { saboresEscolhidos: string[] }; ambiguidade?: unknown };
    expect(estado.atual?.saboresEscolhidos).toEqual(["Calabresa", "Estrogonofe de Frango"]);
    expect(estado.ambiguidade).toBeUndefined();

    // Só o PRÓXIMO dado que falta — o tamanho — deve ser perguntado.
    expect(r4).toMatch(/tamanho/i);
    expect(r4).not.toMatch(/o que você (está com vontade de pedir|gostaria de pedir)/i);
  });

  it("um sabor ambíguo sozinho também gera pergunta, nunca escolha", async () => {
    await enviar("boa noite");
    const r = await enviar("quero uma pizza de estrogonofe");
    expect(r).toMatch(/estrogonofe de carne/i);
    expect(r).toMatch(/estrogonofe de frango/i);
    const estado = conversa.dados as { atual?: { saboresEscolhidos: string[] } };
    expect(estado.atual?.saboresEscolhidos ?? []).toEqual([]);
  });

  it("o nome só é gravado com evidência explícita", async () => {
    await enviar("boa noite");
    await enviar("pizza calabresa metade strogonofe");
    expect((conversa.dados as { cliente?: { nome: string | null } }).cliente?.nome).toBeNull();

    await enviar("frango");
    await enviar("grande");
    // Agora sim, uma apresentação de verdade.
    await enviar("meu nome é Victor");
    expect((conversa.dados as { cliente?: { nome: string | null } }).cliente?.nome).toBe("Victor");
  });
});
