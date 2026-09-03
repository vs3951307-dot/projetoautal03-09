import { describe, it, expect } from "vitest";
import {
  calcularTaxaEntrega,
  distanciaKmHaversine,
  normalizarConfigTaxaEntrega,
  TAXA_ENTREGA_PADRAO,
  type ConfigTaxaEntrega,
} from "@/lib/delivery";

describe("calcularTaxaEntrega — regra por bairro (PEDIDO 13)", () => {
  const config: ConfigTaxaEntrega = {
    ...TAXA_ENTREGA_PADRAO,
    regra: "bairro",
    valorPadrao: 9.9,
    bairros: [
      { bairro: "Centro", valor: 5.0 },
      { bairro: "Jardins", valor: 8.5 },
    ],
    bairrosNaoAtendidos: ["Vila Industrial"],
  };

  it("aplica valor do bairro conhecido", () => {
    const r = calcularTaxaEntrega(config, "Centro", 40);
    expect(r.taxa).toBe(5.0);
    expect(r.atende).toBe(true);
    expect(r.exigeHumano).toBe(false);
  });

  it("cai no valor padrão para bairro desconhecido", () => {
    const r = calcularTaxaEntrega(config, "Bairro Novo", 40);
    expect(r.taxa).toBe(9.9);
    expect(r.atende).toBe(true);
  });

  it("não atende bairro na lista de não-atendidos", () => {
    const r = calcularTaxaEntrega(config, "Vila Industrial", 40);
    expect(r.atende).toBe(false);
    expect(r.taxa).toBe(0);
    expect(r.motivo).toContain("não atendemos");
  });

  it("sem bairro informado pede confirmação humana", () => {
    const r = calcularTaxaEntrega(config, null, 40);
    expect(r.exigeHumano).toBe(true);
    expect(r.atende).toBe(false);
  });

  it("entrega grátis acima do subtotal mínimo", () => {
    const r = calcularTaxaEntrega({ ...config, gratisAcima: 80 }, "Centro", 100);
    expect(r.gratuito).toBe(true);
    expect(r.taxa).toBe(0);
    expect(r.atende).toBe(true);
  });
});

describe("calcularTaxaEntrega — regra por distância (PEDIDO 13)", () => {
  const config: ConfigTaxaEntrega = {
    ...TAXA_ENTREGA_PADRAO,
    regra: "distancia",
    valorPorKm: 2.5,
    taxaMinima: 6.0,
    raioMaximoKm: 20,
  };

  it("calcula taxa proporcional aos km respeitando a mínima", () => {
    const r = calcularTaxaEntrega(config, "Centro", 0, { distanciaEmKm: 2 });
    expect(r.taxa).toBe(6.0); // 2*2.5=5 -> aplica mínima 6
    expect(r.regra).toBe("distancia");
    expect(r.distanciaKm).toBe(2);
    expect(r.atende).toBe(true);
  });

  it("ultrapassa a mínima quando os km crescem", () => {
    const r = calcularTaxaEntrega(config, "Centro", 0, { distanciaEmKm: 5 });
    expect(r.taxa).toBe(12.5); // 5*2.5
  });

  it("não atende além do raio máximo", () => {
    const r = calcularTaxaEntrega(config, "Centro", 0, { distanciaEmKm: 25 });
    expect(r.atende).toBe(false);
    expect(r.taxa).toBe(0);
    expect(r.motivo).toContain("raio máximo");
  });

  it("sem km pede confirmação humana", () => {
    const r = calcularTaxaEntrega(config, "Centro", 0);
    expect(r.exigeHumano).toBe(true);
    expect(r.distanciaKm).toBeUndefined();
  });
});

describe("calcularTaxaEntrega — distância com taxa base (taxaBase + km×valorPorKm)", () => {
  const config: ConfigTaxaEntrega = {
    ...TAXA_ENTREGA_PADRAO,
    regra: "distancia",
    taxaBase: 1,
    valorPorKm: 1,
    taxaMinima: 0,
    raioMaximoKm: 20,
  };

  it("soma a taxa base à distância (6, 10, 13, 16 km)", () => {
    const esperado: Array<[number, number]> = [
      [6, 7],
      [10, 11],
      [13, 14],
      [16, 17],
    ];
    for (const [km, taxa] of esperado) {
      const r = calcularTaxaEntrega(config, "Centro", 0, { distanciaEmKm: km });
      expect(r.taxa).toBe(taxa);
      expect(r.atende).toBe(true);
    }
  });

  it("aplica taxa mínima quando a base + distância fica abaixo dela", () => {
    const comMinima = { ...config, taxaBase: 1, valorPorKm: 1, taxaMinima: 8 };
    const r = calcularTaxaEntrega(comMinima, "Centro", 0, { distanciaEmKm: 6 }); // 1+6=7 < 8
    expect(r.taxa).toBe(8);
  });

  it("recusa bairro na lista de não-atendidos mesmo na regra distância", () => {
    const comJatei = { ...config, bairrosNaoAtendidos: ["Jateí"] };
    const r = calcularTaxaEntrega(comJatei, "Jateí", 50);
    expect(r.atende).toBe(false);
    expect(r.taxa).toBe(0);
    expect(r.motivo).toContain("não atendemos");
  });
});

describe("normalizarConfigTaxaEntrega (PEDIDO 13)", () => {
  it("aceita a regra 'distancia' e os novos campos", () => {
    const n = normalizarConfigTaxaEntrega({
      regra: "distancia",
      taxaBase: 1,
      valorPorKm: 1,
      taxaMinima: 7,
      raioMaximoKm: 15,
      bairrosNaoAtendidos: ["Zona Norte"],
    });
    expect(n.regra).toBe("distancia");
    expect(n.taxaBase).toBe(1);
    expect(n.valorPorKm).toBe(1);
    expect(n.taxaMinima).toBe(7);
    expect(n.raioMaximoKm).toBe(15);
    expect(n.bairrosNaoAtendidos).toEqual(["Zona Norte"]);
  });

  it("valores negativos viram 0", () => {
    const n = normalizarConfigTaxaEntrega({ regra: "bairro", valorPorKm: -5, taxaMinima: -3 });
    expect(n.valorPorKm).toBe(0);
    expect(n.taxaMinima).toBe(0);
  });

  it("lê pontoReferencia (lat/lng) e ignora valor inválido", () => {
    const comPonto = normalizarConfigTaxaEntrega({ regra: "distancia", pontoReferencia: { lat: -22.4889, lng: -54.2994 } });
    expect(comPonto.pontoReferencia).toEqual({ lat: -22.4889, lng: -54.2994 });
    const semPonto = normalizarConfigTaxaEntrega({ regra: "distancia", pontoReferencia: { lat: "x", lng: 1 } });
    expect(semPonto.pontoReferencia).toBeUndefined();
  });
});

describe("calcularTaxaEntrega — arredonda a distância TARIFADA para cima (ceil)", () => {
  // Regra comercial Rozeno: km cobrado = ceil(distância); 12,99 km → 13 km.
  // A distância ORIGINAL (auditoria) segue em `distanciaKm`.
  const config: ConfigTaxaEntrega = {
    ...TAXA_ENTREGA_PADRAO,
    regra: "distancia",
    taxaBase: 1,
    valorPorKm: 1,
    taxaMinima: 0,
    raioMaximoKm: 20,
  };

  it("aprox. 13 km (12,99) cobra R$ 14,00 (ceil(12,99)=13 → 1+13)", () => {
    const r = calcularTaxaEntrega(config, "Centro", 50, { distanciaEmKm: 12.99 });
    expect(r.taxa).toBe(14);
    // Auditoria: preserva a distância bruta calculada.
    expect(r.distanciaKm).toBe(12.99);
  });

  it("km inteiro exato é cobrado como ele mesmo (9 → 1+9=10)", () => {
    const r = calcularTaxaEntrega(config, "Centro", 50, { distanciaEmKm: 9 });
    expect(r.taxa).toBe(10);
    expect(r.distanciaKm).toBe(9);
  });

  it("fração pequena (3,05) é arredondada para cima (4 → 1+4=5)", () => {
    const r = calcularTaxaEntrega(config, "Centro", 50, { distanciaEmKm: 3.05 });
    expect(r.taxa).toBe(5);
    expect(r.distanciaKm).toBe(3.05);
  });

  it("13 km via Haversine vira R$ 14,00 exato (conversa == banco)", () => {
    const loja = { lat: -22.4889, lng: -54.2994 };
    const cliente = { lat: -22.4889, lng: -54.173 };
    const km = distanciaKmHaversine(loja, cliente); // ~12,99
    const r = calcularTaxaEntrega(config, "Centro", 50, { distanciaEmKm: km });
    expect(r.taxa).toBe(14);
    expect(r.distanciaKm).toBeCloseTo(km, 5);
  });
});

describe("distanciaKmHaversine (PEDIDO 17 — geolocalização)", () => {
  it("mede ~13 km ao mover 0.126° em longitude a ~22.49°S", () => {
    const loja = { lat: -22.4889, lng: -54.2994 };
    const cliente = { lat: -22.4889, lng: -54.173 };
    const km = distanciaKmHaversine(loja, cliente);
    expect(km).toBeGreaterThan(12.5);
    expect(km).toBeLessThan(13.5);
  });

  it("mede ~0 km para o mesmo ponto", () => {
    const p = { lat: -22.4889, lng: -54.2994 };
    expect(distanciaKmHaversine(p, p)).toBeCloseTo(0);
  });

  it("roda ponta a ponta (13 km → taxaBase+km)", () => {
    const config = normalizarConfigTaxaEntrega({
      regra: "distancia",
      taxaBase: 1,
      valorPorKm: 1,
      taxaMinima: 0,
      raioMaximoKm: 20,
      pontoReferencia: { lat: -22.4889, lng: -54.2994 },
    });
    const cliente13 = { lat: -22.4889, lng: -54.173 };
    const km = distanciaKmHaversine(config.pontoReferencia!, cliente13);
    const r = calcularTaxaEntrega(config, "Centro", 50, { distanciaEmKm: km });
    expect(r.taxa).toBeGreaterThan(13);
    expect(r.taxa).toBeLessThan(14.1);
    expect(r.exigeHumano).toBe(false);
  });
});
