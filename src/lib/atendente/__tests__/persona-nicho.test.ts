import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    configuracao: { findUnique: vi.fn(), findFirst: vi.fn() },
  },
}));

const {
  montarSaudacao,
  PERSONA_PADRAO,
  personaTemConfiguracao,
  emojiDoNicho,
} = await import("@/lib/atendente/persona");
import type { PersonaAtendente } from "@/lib/atendente/persona";

describe("persona multi-nicho", () => {
  it("considera config existente quando só há nicho diferente do padrão", () => {
    const p: PersonaAtendente = { ...PERSONA_PADRAO, nicho: "farmacia" };
    expect(personaTemConfiguracao(p)).toBe(true);
  });

  it("saudação de farmácia não usa emoji de pizza", () => {
    const p: PersonaAtendente = {
      ...PERSONA_PADRAO,
      nome: "Ana",
      nicho: "farmacia",
    };
    const s = montarSaudacao(p, null, "Drogaria Central");
    expect(s).toContain("Ana");
    expect(s).toContain("💊");
    expect(s).not.toContain("🍕");
  });

  it("saudação custom prevalece", () => {
    const p: PersonaAtendente = {
      ...PERSONA_PADRAO,
      saudacaoCustom: "Bem-vindo à {{loja}}, {{nome}}!",
      nicho: "moda",
    };
    const s = montarSaudacao(p, "João", "Moda Sul");
    expect(s).toBe("Bem-vindo à Moda Sul, João!");
  });

  it("emojiDoNicho respeita nicho", () => {
    expect(emojiDoNicho("petshop")).toBe("🐾");
    expect(emojiDoNicho("generico")).toBe("😊");
  });
});
