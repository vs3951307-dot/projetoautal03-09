import { describe, it, expect } from "vitest";
import { classificarAcao } from "@/lib/atendente/permissoes";
import { perguntaNoMeio, type EstadoSlots } from "@/lib/atendente/slots";

/**
 * PEDIDO 1 — perguntas coloquiais sobre operação ("tá aberto ainda?", "tá
 * fazendo pizza?", "ainda tão entregando?") devem ser classificadas como
 * consulta de HORÁRIO, e NÃO desviar para busca de produto / pedido.
 */
describe("intenção de horário coloquial (PEDIDO 1)", () => {
  it.each([
    "tá aberto ainda?",
    "ainda tá aberto?",
    "vocês estão abertos?",
    "tá fazendo pizza ainda?",
    "ainda tão fazendo?",
    "tão fazendo pedido ainda?",
    "ainda tá funcionando?",
    "vocês vão até que horas?",
    "até que horas vocês fazem?",
  ])("classifica %j como ver_horario", (frase) => {
    expect(classificarAcao(frase, "saudacao")).toBe("ver_horario");
  });
});

describe("pergunta avulsa de horário no meio do pedido (PEDIDO 1)", () => {
  const estadoComRascunho = {
    atual: { nome: "pizza", temTamanhos: true, temSabores: true, tamanhos: [], sabores: [], saboresEscolhidos: [], quantidade: 1 },
    itens: [],
  } as unknown as EstadoSlots;

  it.each(["ainda tá fazendo?", "tá aberto agora?", "vão até que horas?"])(
    "detecta %j como pergunta avulsa de horário",
    (frase) => {
      expect(perguntaNoMeio(frase, estadoComRascunho)).toBe("horario");
    }
  );
});
