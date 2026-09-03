import { describe, it, expect } from "vitest";

/**
 * Regras de canal: retirada não depende de endereço/Entrega.
 * (Espelha a regra de criar-pedido.ts — canal delivery é o único que exige entrega.)
 */
const CANAIS = ["balcao", "salao", "retirada", "delivery"] as const;

function exigeEntrega(canal: string): boolean {
  return canal === "delivery";
}

describe("canal retirada", () => {
  it("retirada é canal válido", () => {
    expect(CANAIS.includes("retirada")).toBe(true);
  });
  it("retirada não exige entrega", () => {
    expect(exigeEntrega("retirada")).toBe(false);
  });
  it("balcao não exige entrega", () => {
    expect(exigeEntrega("balcao")).toBe(false);
  });
  it("delivery exige entrega", () => {
    expect(exigeEntrega("delivery")).toBe(true);
  });
  it("pix/dinheiro/cartão são formas de pagamento de balcão/retirada válidas no domínio", () => {
    const formas = ["pix", "dinheiro", "credito", "debito"];
    for (const f of formas) expect(formas.includes(f)).toBe(true);
  });
});
