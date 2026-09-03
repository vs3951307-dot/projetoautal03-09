import { describe, it, expect } from "vitest";
import { empresaPodeOperarSistema, TRIAL_DIAS_PADRAO } from "@/lib/assinatura";

describe("empresaPodeOperarSistema", () => {
  it("bloqueia trial vencido", () => {
    const r = empresaPodeOperarSistema({
      status: "teste",
      trialFimEm: new Date(Date.now() - 60_000),
      vencimentoEm: null,
      carenciaAte: null,
    });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe("trial_vencido");
  });

  it("permite trial no último dia", () => {
    const r = empresaPodeOperarSistema({
      status: "teste",
      trialFimEm: new Date(Date.now() + 60_000),
      vencimentoEm: null,
      carenciaAte: null,
    });
    expect(r.ok).toBe(true);
  });

  it("bloqueia trial sem data", () => {
    const r = empresaPodeOperarSistema({
      status: "teste",
      trialFimEm: null,
      vencimentoEm: null,
      carenciaAte: null,
    });
    expect(r.ok).toBe(false);
  });

  it("bloqueia empresa bloqueada", () => {
    const r = empresaPodeOperarSistema({
      status: "bloqueada",
      trialFimEm: null,
      vencimentoEm: null,
      carenciaAte: null,
    });
    expect(r.ok).toBe(false);
  });

  it("trial padrão comercial é 4 dias", () => {
    expect(TRIAL_DIAS_PADRAO).toBe(4);
  });

  it("bloqueia empresa suspensa", () => {
    const r = empresaPodeOperarSistema({
      status: "suspensa",
      trialFimEm: null,
      vencimentoEm: null,
      carenciaAte: null,
    });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe("empresa_suspensa");
  });
});
