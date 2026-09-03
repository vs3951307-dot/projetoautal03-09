import { describe, it, expect, vi, type MockedFunction } from "vitest";

const { mockPrisma, mockChamarIA } = vi.hoisted(() => ({
  mockPrisma: {
    mensagemWhatsApp: { findMany: vi.fn() },
  },
  mockChamarIA: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

vi.mock("@/lib/ai-provider", () => ({
  chamarIA: mockChamarIA,
  iaDisponivel: vi.fn(() => true),
}));

vi.mock("@/lib/uso-ia", () => ({
  limiteIaExcedido: vi.fn(async () => false),
  registrarUsoIA: vi.fn(async () => {}),
  estimarTokens: vi.fn(() => 100),
}));

vi.mock("@/lib/atendente/persona", () => ({
  carregarPersonaAtendente: vi.fn(async () => ({
    nome: "Ana", tom: "simpatico" as const, nicho: "generico" as const,
    regras: "", horario: "", saudacaoCustom: "", instrucoesAdicionais: "", iaAtiva: true,
  })),
  montarSaudacao: vi.fn(() => "Oi!"),
  RESTRICOES_FLUXO: "",
}));

vi.mock("@/lib/atendente/catalogo", () => ({
  nomeFantasia: vi.fn(async () => "Disk Pizza Rozeno"),
  listarProdutosDisponiveis: vi.fn(async () => [
    { id: "p1", nome: "Calabresa", precoBase: 39.9, categoria: "Pizzas salgadas", emoji: "P", descricao: "", fotoUrl: null, destaque: false, disponivel: true, temSabores: true, temTamanhos: true, tamanhos: [], sabores: [] },
    { id: "p3", nome: "X-Burguer", precoBase: 18.0, categoria: "Lanches", emoji: "🍔", descricao: "", fotoUrl: null, destaque: false, disponivel: true, temSabores: false, temTamanhos: false, tamanhos: [], sabores: [] },
  ]),
}));

vi.mock("@/lib/atendente/ia", () => ({
  iaDisponivel: vi.fn(() => true),
}));

// NOTA: NÃO mockamos "@/lib/atendente/agente" — queremos testar o agente real.

describe("Agente - histórico real da conversa", () => {
  it("inclui o historico real no prompt (nao trata a mensagem isolada)", async () => {
    const { agenteProcessar } = await import("@/lib/atendente/agente");
    const { chamarIA } = await import("@/lib/ai-provider");

    const chamadas: string[] = [];
    (mockChamarIA as unknown as MockedFunction<(papel: string, args: { prompt: string }) => unknown>)
      .mockImplementation(async (_papel, { prompt }) => {
        chamadas.push(prompt);
        return { texto: '{"texto":"Ok, anotei o artesanal."}', tokensEntrada: 1, tokensSaida: 1, provedor: "openai", modelo: "gpt-4o-mini" };
      });

    (mockPrisma.mensagemWhatsApp.findMany as unknown as MockedFunction<() => Promise<unknown>>)
      .mockResolvedValue([
        { de: "cliente", texto: "quero um lanche", criadoEm: new Date() },
        { de: "sistema", texto: "Temos X-Burguer e X-Tudo", criadoEm: new Date() },
        { de: "cliente", texto: "qual eh artesanal", criadoEm: new Date() },
      ]);

    const resultado = await agenteProcessar("emp1", "+5511999999999", "quero o artesanal", "intencao", { itens: [], tentativas: 0 }, "conv1");
    expect(resultado).not.toBeNull();

    const prompt = chamadas[0] ?? "";
    expect(prompt).toContain("HISTORICO RECENTE DA CONVERSA");
    expect(prompt).toContain("Cliente: quero um lanche");
    expect(prompt).toContain("Cliente: qual eh artesanal");
  });

  it("nao inclui secao de historico quando nao ha conversaId", async () => {
    const { agenteProcessar } = await import("@/lib/atendente/agente");
    const chamadas: string[] = [];
    (mockChamarIA as unknown as MockedFunction<(papel: string, args: { prompt: string }) => unknown>)
      .mockImplementation(async (_papel, { prompt }) => {
        chamadas.push(prompt);
        return { texto: '{"texto":"Ok."}', tokensEntrada: 1, tokensSaida: 1, provedor: "openai", modelo: "gpt-4o-mini" };
      });

    const resultado = await agenteProcessar("emp1", "+5511999999999", "oi", "intencao", { itens: [], tentativas: 0 });
    expect(resultado).not.toBeNull();
    expect(chamadas[0] ?? "").not.toContain("HISTORICO RECENTE DA CONVERSA");
  });
});
