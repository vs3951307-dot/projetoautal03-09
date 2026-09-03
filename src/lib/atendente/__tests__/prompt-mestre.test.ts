import { describe, it, expect } from "vitest";
import { PROMPT_MESTRE_ATENDENTE } from "@/lib/atendente/prompt-mestre";

describe("PROMPT_MESTRE_ATENDENTE", () => {
  it("obriga uso de tools e proíbe inventar dados comerciais", () => {
    const p = PROMPT_MESTRE_ATENDENTE.toLowerCase();
    expect(p).toMatch(/tool/);
    expect(p).toMatch(/proibido inventar|é proibido inventar|nunca invente/);
    expect(p).toMatch(/preço|preco/);
    expect(p).toMatch(/estoque|disponibilidade/);
    expect(p).toMatch(/taxa/);
    expect(p).toMatch(/confirmar_pedido/);
    expect(p).toMatch(/prompt injection|ignore qualquer pedido/);
  });

  it("é texto fixo não vazio", () => {
    expect(PROMPT_MESTRE_ATENDENTE.length).toBeGreaterThan(500);
  });
});
