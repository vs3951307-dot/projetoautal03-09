// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  escopoDoCarrinho,
  limparChaveIdempotencia,
  obterChaveIdempotencia,
  TTL_CHAVE_MS,
} from "../idempotencia-cliente";

const PREFIXO = "pf_idem_";

function itens(...pares: [string, number][]) {
  return pares.map(([produtoId, quantidade]) => ({ produtoId, quantidade, tamanho: null }));
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("escopoDoCarrinho", () => {
  it("é estável à ordem dos itens", () => {
    expect(escopoDoCarrinho(3, itens(["a", 1], ["b", 2]))).toBe(
      escopoDoCarrinho(3, itens(["b", 2], ["a", 1]))
    );
  });

  it("muda com mesa, produto, quantidade e tamanho", () => {
    const base = escopoDoCarrinho(3, itens(["a", 1]));
    expect(escopoDoCarrinho(4, itens(["a", 1]))).not.toBe(base);
    expect(escopoDoCarrinho(3, itens(["b", 1]))).not.toBe(base);
    expect(escopoDoCarrinho(3, itens(["a", 2]))).not.toBe(base);
    expect(
      escopoDoCarrinho(3, [{ produtoId: "a", quantidade: 1, tamanho: "Grande" }])
    ).not.toBe(base);
  });

  it("preserva a assinatura completa — não é só um hash", () => {
    const escopo = escopoDoCarrinho(7, itens(["prod-1", 2]));
    expect(escopo).toContain("prod-1");
    expect(escopo).toContain("7");
  });
});

describe("obterChaveIdempotencia", () => {
  it("reenvio do mesmo carrinho reusa a chave", () => {
    const escopo = escopoDoCarrinho(3, itens(["a", 1]));
    const k1 = obterChaveIdempotencia(escopo);
    expect(obterChaveIdempotencia(escopo)).toBe(k1);
  });

  it("carrinho diferente gera chave diferente", () => {
    const k1 = obterChaveIdempotencia(escopoDoCarrinho(3, itens(["a", 1])));
    const k2 = obterChaveIdempotencia(escopoDoCarrinho(3, itens(["b", 1])));
    expect(k1).not.toBe(k2);
  });

  it("COLISÃO DE BUCKET: o escopo é guardado junto e conferido na leitura", () => {
    const escopo = escopoDoCarrinho(3, itens(["a", 1]));
    const chave = obterChaveIdempotencia(escopo);
    const bucket = Object.keys(window.sessionStorage).find((k) => k.startsWith(PREFIXO))!;

    // O registro precisa ser conferível: sem o escopo original guardado,
    // dois carrinhos que colidissem no djb2 dividiriam a mesma UUID e o
    // segundo pedido seria engolido pelo dedupe do servidor.
    const registro = JSON.parse(window.sessionStorage.getItem(bucket)!);
    expect(registro.escopo).toBe(escopo);
    expect(registro.chave).toBe(chave);

    // Simula outro carrinho ocupando o mesmo bucket: NÃO pode reusar a chave.
    window.sessionStorage.setItem(
      bucket,
      JSON.stringify({ escopo: "outro-carrinho", chave: "uuid-alheia", criadoEm: Date.now() })
    );
    expect(obterChaveIdempotencia(escopo)).not.toBe("uuid-alheia");
  });

  it("registro expirado gera chave nova — 2a rodada idêntica não é engolida", () => {
    const escopo = escopoDoCarrinho(3, itens(["a", 1]));
    const k1 = obterChaveIdempotencia(escopo);
    const bucket = Object.keys(window.sessionStorage).find((k) => k.startsWith(PREFIXO))!;
    const reg = JSON.parse(window.sessionStorage.getItem(bucket)!);
    reg.criadoEm = Date.now() - (TTL_CHAVE_MS + 1000);
    window.sessionStorage.setItem(bucket, JSON.stringify(reg));
    expect(obterChaveIdempotencia(escopo)).not.toBe(k1);
  });

  it("registro legado (UUID cru, sem escopo) é descartado", () => {
    const escopo = escopoDoCarrinho(3, itens(["a", 1]));
    obterChaveIdempotencia(escopo);
    const bucket = Object.keys(window.sessionStorage).find((k) => k.startsWith(PREFIXO))!;
    window.sessionStorage.setItem(bucket, "uuid-legado-cru");
    expect(obterChaveIdempotencia(escopo)).not.toBe("uuid-legado-cru");
  });

  it("gera UUID v4 sem crypto.randomUUID (contexto HTTP não-seguro)", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (a: Uint8Array) => {
        for (let i = 0; i < a.length; i++) a[i] = (i * 7) % 256;
        return a;
      },
    });
    const k = obterChaveIdempotencia(escopoDoCarrinho(3, itens(["a", 1])));
    expect(k).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});

describe("limparChaveIdempotencia", () => {
  it("após sucesso, o próximo pedido igual recebe chave nova", () => {
    const escopo = escopoDoCarrinho(3, itens(["a", 1]));
    const k1 = obterChaveIdempotencia(escopo);
    limparChaveIdempotencia(escopo);
    expect(obterChaveIdempotencia(escopo)).not.toBe(k1);
  });

  it("não apaga registro de outro carrinho no mesmo bucket", () => {
    const escopo = escopoDoCarrinho(3, itens(["a", 1]));
    obterChaveIdempotencia(escopo);
    const bucket = Object.keys(window.sessionStorage).find((k) => k.startsWith(PREFIXO))!;
    window.sessionStorage.setItem(
      bucket,
      JSON.stringify({ escopo: "alheio", chave: "uuid-alheia", criadoEm: Date.now() })
    );
    limparChaveIdempotencia(escopo);
    expect(window.sessionStorage.getItem(bucket)).toBeTruthy();
  });
});
