import { describe, it, expect } from "vitest";
import { resolver, normalizar, perguntarEntre } from "@/lib/atendente/resolver";
import { extrairNomeCliente } from "@/lib/atendente/nome-cliente";
import { lerSabores } from "@/lib/atendente/sabores";

const SABORES = [
  { nome: "Calabresa", tipo: "tradicional" },
  { nome: "Estrogonofe de Carne", tipo: "especial" },
  { nome: "Estrogonofe de Frango", tipo: "especial" },
  { nome: "Mussarela", tipo: "tradicional" },
  { nome: "Portuguesa", tipo: "tradicional" },
];

const PRODUTOS = [
  { nome: "Coca-Cola 2L" },
  { nome: "Coca-Cola 1L" },
  { nome: "Coca-Cola 600ml" },
  { nome: "Guaraná 2L" },
  { nome: "Pizza Grande" },
];

describe("resolver de catálogo", () => {
  it("EXACT quando o nome bate igual", () => {
    const r = resolver("calabresa", SABORES);
    expect(r.tipo).toBe("EXACT");
    expect(r.escolhido?.nome).toBe("Calabresa");
  });

  it("MULTIPLE para 'strogonoff' — NUNCA escolhe sozinho", () => {
    for (const grafia of ["strogonoff", "strogonof", "estrogonofe", "extrogonofe"]) {
      const r = resolver(grafia, SABORES);
      expect(r.tipo, `grafia: ${grafia}`).toBe("MULTIPLE");
      expect(r.escolhido).toBeUndefined();
      expect(r.candidatos.map((c) => c.nome).sort()).toEqual([
        "Estrogonofe de Carne",
        "Estrogonofe de Frango",
      ]);
    }
  });

  it("UNIQUE quando o cliente desambigua", () => {
    const r = resolver("estrogonofe de frango", SABORES);
    expect(r.tipo).toBe("EXACT");
    expect(r.escolhido?.nome).toBe("Estrogonofe de Frango");
  });

  it("resolve 'frango' dentro do subconjunto ambíguo", () => {
    const pendentes = SABORES.filter((s) => s.nome.startsWith("Estrogonofe"));
    const r = resolver("frango", pendentes);
    expect(r.tipo).toBe("UNIQUE");
    expect(r.escolhido?.nome).toBe("Estrogonofe de Frango");
  });

  it("NONE não inventa produto", () => {
    expect(resolver("sushi", SABORES).tipo).toBe("NONE");
  });

  it("entende litragem escrita por extenso", () => {
    expect(normalizar("coca dois litros")).toContain("2l");
    const r = resolver("coca dois litros", PRODUTOS);
    expect(r.tipo).toBe("UNIQUE");
    expect(r.escolhido?.nome).toBe("Coca-Cola 2L");
  });

  it("'coca' sozinha é ambígua entre os tamanhos", () => {
    const r = resolver("coca", PRODUTOS);
    expect(r.tipo).toBe("MULTIPLE");
    expect(r.candidatos.length).toBe(3);
  });

  it("não aceita erro de digitação em palavra curta (evita venda errada)", () => {
    // "carne" -> "carno" não pode virar match seguro por si só.
    const r = resolver("carno", [{ nome: "Carne" }, { nome: "Carro" }]);
    expect(r.escolhido).toBeUndefined();
  });

  it("perguntarEntre formata a lista", () => {
    expect(perguntarEntre(["A", "B"])).toBe("A ou B");
    expect(perguntarEntre(["A", "B", "C"])).toBe("A, B ou C");
  });
});

describe("regra absoluta do nome", () => {
  it("aceita apresentações explícitas", () => {
    expect(extrairNomeCliente("meu nome é Victor")).toBe("Victor");
    expect(extrairNomeCliente("sou o Victor")).toBe("Victor");
    expect(extrairNomeCliente("pode colocar no nome de Victor")).toBe("Victor");
    expect(extrairNomeCliente("me chamo Ana Paula")).toBe("Ana Paula");
  });

  it("NUNCA aceita produto, sabor, endereço, pagamento ou observação", () => {
    const invalidos = [
      "calabresa",
      "estrogonofe",
      "pizza grande",
      "pix",
      "rua das flores",
      "sem cebola",
      "duas coca",
      "Pizza Calabresa e Estrogonofe de Carne",
      "quero uma pizza",
      "metade calabresa metade frango",
      "vou buscar",
    ];
    for (const t of invalidos) {
      expect(extrairNomeCliente(t), `texto: ${t}`).toBeNull();
      expect(extrairNomeCliente(t, true), `texto (pergunta direta): ${t}`).toBeNull();
    }
  });

  it("resposta seca só vira nome quando a pergunta foi feita", () => {
    expect(extrairNomeCliente("Victor")).toBeNull();
    expect(extrairNomeCliente("Victor", true)).toBe("Victor");
  });
});

describe("leitura de sabores / meio a meio", () => {
  it("o caso do bug: 'pizza calabresa metade strogonofe'", () => {
    const r = lerSabores("pizza calabresa metade strogonofe", SABORES);
    expect(r.meioAMeio).toBe(true);
    expect(r.resolvidos).toEqual(["Calabresa"]);
    expect(r.ambiguos).toHaveLength(1);
    expect(r.ambiguos[0].candidatos.sort()).toEqual([
      "Estrogonofe de Carne",
      "Estrogonofe de Frango",
    ]);
    expect(r.quantidade).toBe(2);
  });

  it("meio a meio sem ambiguidade resolve os dois", () => {
    const r = lerSabores("metade calabresa metade portuguesa", SABORES);
    expect(r.resolvidos).toEqual(["Calabresa", "Portuguesa"]);
    expect(r.ambiguos).toHaveLength(0);
    expect(r.quantidade).toBe(2);
  });

  it("aceita abreviações do WhatsApp", () => {
    const r = lerSabores("metd calabresa metd mussarela", SABORES);
    expect(r.resolvidos).toEqual(["Calabresa", "Mussarela"]);
  });

  it("aceita 1/2 e ignora tamanho", () => {
    const r = lerSabores("uma grande 1/2 calabresa 1/2 portuguesa", SABORES);
    expect(r.resolvidos).toEqual(["Calabresa", "Portuguesa"]);
    expect(r.meioAMeio).toBe(true);
  });

  it("sabor único não vira meio a meio", () => {
    const r = lerSabores("quero uma calabresa", SABORES);
    expect(r.meioAMeio).toBe(false);
    expect(r.resolvidos).toEqual(["Calabresa"]);
  });

  it("reporta sabor inexistente sem inventar", () => {
    const r = lerSabores("metade calabresa metade banana", SABORES);
    expect(r.resolvidos).toEqual(["Calabresa"]);
    expect(r.desconhecidos).toContain("banana");
  });
});
