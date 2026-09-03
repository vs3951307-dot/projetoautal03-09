import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

const { montarSaudacao, saudacaoInicial } = await import("@/lib/atendente/persona");

interface PersonaAtendente {
  nome: string;
  tom: "simpatico" | "profissional" | "descontraido" | "formal";
  regras: string;
  horario: string;
  nicho?: "pizzaria" | "farmacia" | "generico" | string;
  saudacaoCustom?: string;
}

const personaAna: PersonaAtendente = {
  nome: "Ana",
  tom: "simpatico",
  nicho: "generico",
  regras: "",
  horario: "",
};

describe("montarSaudacao — saudação única do atendente", () => {
  it("retorna saudação com nome da atendente e da loja", () => {
    const resultado = montarSaudacao(personaAna as any, null, "Loja Centro");
    expect(resultado).toContain("Ana");
    expect(resultado).toContain("Loja Centro");
    expect(resultado).toContain("Como posso te ajudar?");
    expect(resultado).not.toContain("🍕");
  });

  it("retorna saudação com nome do cliente quando informado", () => {
    const resultado = montarSaudacao(personaAna as any, "João", "Loja Centro");
    expect(resultado).toContain("João");
    expect(resultado).toContain("Ana");
  });

  it("usa emoji do nicho pizzaria apenas quando nicho for pizzaria", () => {
    const p = { ...personaAna, nicho: "pizzaria" };
    const resultado = montarSaudacao(p as any, null, "Pizzaria Sul");
    expect(resultado).toContain("🍕");
  });

  it("usa 'nossa loja' quando loja não informada", () => {
    const resultado = montarSaudacao(personaAna as any, null);
    expect(resultado).toContain("nossa loja");
  });

  it("saudacaoInicial delega para montarSaudacao", () => {
    expect(saudacaoInicial(personaAna as any, "Maria", "Loja X")).toBe(
      montarSaudacao(personaAna as any, "Maria", "Loja X")
    );
  });
});
