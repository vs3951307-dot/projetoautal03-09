import { describe, it, expect } from "vitest";
import { arredondarDinheiro, somarDinheiro, multiplicarDinheiro, paraCentavos } from "@/lib/dinheiro";

describe("dinheiro centavos", () => {
  it("evita 0.1 + 0.2", () => {
    expect(somarDinheiro(0.1, 0.2)).toBe(0.3);
  });
  it("arredonda 2 casas", () => {
    expect(arredondarDinheiro(10.005)).toBe(10.01);
  });
  it("multiplica quantidade", () => {
    expect(multiplicarDinheiro(19.9, 3)).toBe(59.7);
  });
  it("paraCentavos", () => {
    expect(paraCentavos(10.5)).toBe(1050);
  });
});
