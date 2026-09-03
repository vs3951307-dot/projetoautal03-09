import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";

/**
 * Repro de DOM para o TypeError:
 *   "Cannot read properties of undefined (reading 'valor')"
 * que derrubava /admin/relatorios quando a coleção ocupacaoSalao vinha
 * vazia (fallback `OCUPACAO_SALAO = []` de src/lib/relatorios.ts) —
 * acesso a `ocupacaoSalao[0].valor` na linha antiga.
 */

const __rel = vi.hoisted(() => ({
  dados: {
    resumo: [] as unknown[],
    vendasPorHorario: [] as unknown[],
    ocupacaoSalao: [] as never[],
    salaoMesas: [] as unknown[],
  },
}));

vi.mock("@/lib/api-cliente", () => ({
  useApi: () => ({
    dados: __rel.dados,
    carregando: false,
    erro: null,
    recarregar: () => {},
  }),
  api: () => Promise.resolve({}),
}));

vi.mock("../_lib/periodo-context", () => ({
  usePeriodoRelatorio: () => "hoje",
}));

vi.mock("sonner", () => ({
  toast: { success: () => {}, error: () => {}, warning: () => {}, info: () => {} },
}));

const { RelatorioSalao } = await import(
  "@/app/admin/relatorios/_components/relatorio-salao"
);

describe("RelatorioSalao (mount) — DOM", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("não lança quando ocupacaoSalao está vazia (relatório sem mesas/movimentação)", async () => {
    __rel.dados = {
      resumo: [] as unknown[],
      vendasPorHorario: [] as unknown[],
      ocupacaoSalao: [] as never[],
      salaoMesas: [] as unknown[],
    };
    await act(async () => {
      render(<RelatorioSalao />);
    });
    // Deve exibir o estado vazio de ocupação em vez de quebrar.
    expect(screen.queryByText(/nenhuma mesa registrada/i)).not.toBeNull();
    expect(screen.queryByText(/nenhuma movimentação de salão/i)).not.toBeNull();
  });

  it("renderiza os totais quando ocupacaoSalao tem dados", async () => {
    __rel.dados = {
      resumo: [] as unknown[],
      vendasPorHorario: [] as unknown[],
      ocupacaoSalao: [
        { chave: "ocupadas", rotulo: "Mesas ocupadas", valor: 3, cor: "#953C2A" },
        { chave: "livres", rotulo: "Mesas livres", valor: 2, cor: "#2E8B57" },
      ] as never[],
      salaoMesas: [] as unknown[],
    };
    await act(async () => {
      render(<RelatorioSalao />);
    });
    expect(screen.queryByText(/3 de 5/i)).not.toBeNull();
  });
});
