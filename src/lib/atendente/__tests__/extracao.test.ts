/**
 * Extração de pedido completo — testes UNITÁRIOS, sem banco e sem IA.
 *
 * O catálogo é injetado, então estes testes rodam em qualquer ambiente,
 * inclusive sem o binário do query engine do Prisma.
 */

import { describe, it, expect } from "vitest";
import { extrairPedido, type CatalogoExtracao } from "@/lib/atendente/extracao";

const SABORES = [
  { nome: "Calabresa", tipo: "tradicional" },
  { nome: "Estrogonofe de Carne", tipo: "especial" },
  { nome: "Estrogonofe de Frango", tipo: "especial" },
  { nome: "Portuguesa", tipo: "tradicional" },
];

const CATALOGO: CatalogoExtracao = {
  produtos: [
    {
      id: "p1",
      nome: "Pizza",
      temTamanhos: true,
      temSabores: true,
      tamanhos: [
        { nome: "Media", valor: 45 },
        { nome: "Grande", valor: 55 },
        { nome: "Familia", valor: 70 },
      ],
      sabores: SABORES,
    },
    {
      id: "p2",
      nome: "Coca-Cola 2L",
      temTamanhos: false,
      temSabores: false,
      tamanhos: [],
      sabores: [],
    },
    {
      id: "p3",
      nome: "X-Burguer",
      temTamanhos: false,
      temSabores: false,
      tamanhos: [],
      sabores: [],
    },
  ],
  adicionais: [
    { nome: "Borda de Catupiry", preco: 8 },
    { nome: "Bacon", preco: 5 },
  ],
  formasPagamento: [
    { value: "pix", label: "PIX" },
    { value: "dinheiro", label: "Dinheiro" },
    { value: "credito", label: "Cartão de Crédito" },
    { value: "debito", label: "Cartão de Débito" },
  ],
};

const extrair = (t: string) => extrairPedido(t, CATALOGO);

describe("pedido completo em uma frase (caso obrigatório)", () => {
  const FRASE =
    "Meu nome é Victor, quero uma pizza grande, metade calabresa e metade estrogonofe de carne, vou retirar e pagar no Pix.";

  it("preenche nome, tamanho, sabores, canal e pagamento", () => {
    const r = extrair(FRASE);
    expect(r.nome).toBe("Victor");
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0].produto.nome).toBe("Pizza");
    expect(r.itens[0].tamanho?.nome).toBe("Grande");
    expect(r.itens[0].sabores).toEqual(["Calabresa", "Estrogonofe de Carne"]);
    expect(r.canal).toBe("retirada");
    expect(r.formaPagamento).toBe("pix");
    expect(r.reconheceu).toBe(true);
  });

  it("não sobra nada em desconhecidos nem vira ambiguidade", () => {
    const r = extrair(FRASE);
    expect(r.desconhecidos).toEqual([]);
    expect(r.ambiguidades).toEqual([]);
  });
});

describe("mesma informação em ordem diferente", () => {
  it("ordem trocada dá o mesmo resultado", () => {
    const r = extrair(
      "vou pagar no pix e retirar, pizza grande metade calabresa metade estrogonofe de carne, meu nome é Victor"
    );
    expect(r.nome).toBe("Victor");
    expect(r.itens[0].tamanho?.nome).toBe("Grande");
    expect(r.itens[0].sabores).toEqual(["Calabresa", "Estrogonofe de Carne"]);
    expect(r.canal).toBe("retirada");
    expect(r.formaPagamento).toBe("pix");
  });
});

describe("modalidade e pagamento", () => {
  it("retirada + pix", () => {
    const r = extrair("uma pizza media calabresa, vou buscar, pago no pix");
    expect(r.canal).toBe("retirada");
    expect(r.formaPagamento).toBe("pix");
  });

  it("entrega + endereço + cartão", () => {
    const r = extrair(
      "quero uma pizza grande portuguesa, entrega na Rua das Flores 120, Centro, pago no cartão de crédito"
    );
    expect(r.canal).toBe("entrega");
    expect(r.endereco?.rua).toMatch(/das Flores 120/i);
    expect(r.endereco?.bairro).toMatch(/Centro/i);
    expect(r.formaPagamento).toBe("credito");
  });

  it("endereço sozinho já implica entrega", () => {
    const r = extrair("uma pizza grande portuguesa, manda na Avenida Brasil 45");
    expect(r.canal).toBe("entrega");
  });

  it("dinheiro com troco", () => {
    const r = extrair("uma pizza media portuguesa, entrega, dinheiro, troco para 100");
    expect(r.formaPagamento).toBe("dinheiro");
    expect(r.trocoPara).toBe(100);
  });

  it("dinheiro sem troco", () => {
    const r = extrair("uma pizza media portuguesa, dinheiro, sem troco");
    expect(r.formaPagamento).toBe("dinheiro");
    expect(r.trocoPara).toBe(0);
  });
});

describe("nome", () => {
  it("nome composto", () => {
    expect(extrair("meu nome é Ana Paula Souza, quero uma pizza grande calabresa").nome).toBe(
      "Ana Paula Souza"
    );
  });

  it("corta o nome quando o cliente emenda o pedido", () => {
    expect(extrair("sou o Victor quero uma pizza grande calabresa").nome).toBe("Victor");
  });

  it("nome nunca vira produto e produto nunca vira nome", () => {
    const r = extrair("quero uma pizza grande calabresa, pago no pix");
    expect(r.nome).toBeUndefined();
  });
});

describe("sabores e tamanho", () => {
  it("três sabores no tamanho família", () => {
    const r = extrair(
      "uma pizza familia com calabresa, portuguesa e estrogonofe de frango, retirada, pix"
    );
    expect(r.itens[0].tamanho?.nome).toBe("Familia");
    expect(r.itens[0].sabores).toEqual([
      "Calabresa",
      "Portuguesa",
      "Estrogonofe de Frango",
    ]);
    expect(r.itens[0].saboresPedidos).toBe(3);
  });

  it("meio a meio com só um sabor dito marca que faltam 2", () => {
    const r = extrair("uma pizza grande metade calabresa");
    expect(r.itens[0].saboresPedidos).toBe(2);
    expect(r.itens[0].sabores).toEqual(["Calabresa"]);
  });
});

describe("informação ausente, ambígua e inexistente", () => {
  it("informação ausente fica ausente — nada é inventado", () => {
    const r = extrair("quero uma pizza grande calabresa");
    expect(r.canal).toBeUndefined();
    expect(r.formaPagamento).toBeUndefined();
    expect(r.nome).toBeUndefined();
    expect(r.trocoPara).toBeUndefined();
  });

  it("sabor ambíguo vira pergunta, nunca escolha", () => {
    const r = extrair("uma pizza grande metade calabresa metade estrogonofe, retirada, pix");
    expect(r.itens[0].sabores).toEqual(["Calabresa"]);
    expect(r.ambiguidades).toHaveLength(1);
    expect(r.ambiguidades[0].campo).toBe("sabor");
    expect(r.ambiguidades[0].candidatos.sort()).toEqual([
      "Estrogonofe de Carne",
      "Estrogonofe de Frango",
    ]);
  });

  it("sabor inexistente não vira produto nem pendência", () => {
    const r = extrair("uma pizza grande metade calabresa metade banana, pix");
    expect(r.itens[0].sabores).toEqual(["Calabresa"]);
    expect(r.desconhecidos).toContain("banana");
    expect(r.itens).toHaveLength(1);
  });

  it("produto inexistente não é inventado", () => {
    const r = extrair("quero um sushi grande, pix");
    expect(r.itens).toHaveLength(0);
    expect(r.desconhecidos.length).toBeGreaterThan(0);
  });
});

describe("mensagens compostas", () => {
  it("saudação junto do pedido não atrapalha", () => {
    const r = extrair("boa noite, quero uma pizza grande calabresa, retirada, pix");
    expect(r.itens[0].tamanho?.nome).toBe("Grande");
    expect(r.itens[0].sabores).toEqual(["Calabresa"]);
    expect(r.desconhecidos).toEqual([]);
  });

  it("dois itens diferentes", () => {
    const r = extrair("quero um x-burguer e uma coca-cola 2l");
    expect(r.itens.map((i) => i.produto.nome)).toEqual(["X-Burguer", "Coca-Cola 2L"]);
  });

  it("bebida junto da pizza, com tudo o mais", () => {
    const r = extrair(
      "meu nome é Victor, uma pizza grande metade calabresa metade portuguesa e uma coca dois litros, vou retirar e pagar no pix"
    );
    expect(r.nome).toBe("Victor");
    expect(r.itens.map((i) => i.produto.nome)).toEqual(["Pizza", "Coca-Cola 2L"]);
    expect(r.itens[0].sabores).toEqual(["Calabresa", "Portuguesa"]);
    expect(r.canal).toBe("retirada");
    expect(r.formaPagamento).toBe("pix");
    // "pagar no pix" e "vou retirar" NUNCA podem sobrar como item.
    expect(r.desconhecidos).toEqual([]);
  });

  it("observação 'sem cebola' é observação, não produto", () => {
    const r = extrair("uma pizza grande calabresa sem cebola, retirada, pix");
    expect(r.observacoes).toEqual(["sem cebola"]);
    expect(r.itens).toHaveLength(1);
    expect(r.desconhecidos).toEqual([]);
  });

  it("quantidade explícita é respeitada", () => {
    const r = extrair("quero 2 x-burguer e uma coca-cola 2l");
    expect(r.itens[0].quantidade).toBe(2);
    expect(r.itens[1].quantidade).toBe(1);
  });

  it("adicional é reconhecido", () => {
    const r = extrair("uma pizza grande calabresa com borda de catupiry, pix");
    expect(r.itens[0].adicionais.map((a) => a.nome)).toEqual(["Borda de Catupiry"]);
  });
});

describe("REGRA 11 — palavra isolada não reescreve o pedido", () => {
  it("'grande' sozinho não é considerado extração confiável", () => {
    expect(extrair("grande").reconheceu).toBe(false);
  });

  it("'calabresa' sozinho não é considerado extração confiável", () => {
    expect(extrair("calabresa").reconheceu).toBe(false);
  });

  it("'sim' não é considerado extração confiável", () => {
    expect(extrair("sim").reconheceu).toBe(false);
  });

  it("mas 'uma pizza grande' é", () => {
    expect(extrair("uma pizza grande").reconheceu).toBe(true);
  });
});
