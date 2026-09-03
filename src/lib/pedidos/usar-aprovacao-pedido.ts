"use client";

import { useCallback, useState } from "react";

/**
 * Formato de `listarAguardandoAprovacao` (`@/lib/pedidos/aprovar-rejeitar-pedido`),
 * como a API `GET /api/pedidos/aguardando` devolve. `mesaId` aqui é o
 * NÚMERO da mesa (é o que o Prisma chama de `mesaId` na tabela `Pedido`,
 * mas semanticamente é o número — `criarPedido` faz o lookup por
 * `empresaId_numero`), nunca o id interno.
 */
export interface ItemPedidoAguardando {
  nome: string;
  quantidade: number;
  tamanho: string | null;
  sabores: string[];
  observacao: string | null;
}

export interface PedidoAguardando {
  id: string;
  numero: number;
  canal: string;
  mesaId: number | null;
  clienteNome: string | null;
  total: number;
  criadoEm: string;
  itens: ItemPedidoAguardando[];
}

type Resultado =
  | { ok: true; producao: string }
  | { ok: false; codigo: string; mensagem: string };

/** Chama a rota já existente e testada: POST /api/pedidos/:id/aprovacao. */
export async function postAprovacao(
  pedidoId: string,
  acao: "aprovar" | "rejeitar",
  motivo?: string
): Promise<Resultado> {
  let res: Response;
  try {
    res = await fetch(`/api/pedidos/${pedidoId}/aprovacao`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(acao === "rejeitar" ? { acao, motivo } : { acao }),
    });
  } catch {
    // Sem isto a exceção de rede subia pelo try/finally de aprovar/rejeitar
    // sem passar por setErro: o operador clicava e NADA acontecia na tela.
    return {
      ok: false,
      codigo: "REDE",
      mensagem: "Sem resposta do servidor. A ação pode não ter sido aplicada — atualize a fila.",
    };
  }
  const dados = await res.json().catch(() => ({}));
  if (!res.ok || dados?.ok === false) {
    return {
      ok: false,
      codigo: dados?.codigo ?? "ERRO",
      mensagem: dados?.mensagem ?? "Falha ao processar o pedido.",
    };
  }
  return { ok: true, producao: dados.producao ?? (acao === "aprovar" ? "recebido" : "finalizado") };
}

/** Lista atual da fila: GET /api/pedidos/aguardando. */
export async function buscarFilaAprovacao(): Promise<PedidoAguardando[]> {
  const res = await fetch("/api/pedidos/aguardando", { cache: "no-store" });
  if (!res.ok) throw new Error("Não foi possível carregar a fila de aprovação.");
  const dados = await res.json();
  return Array.isArray(dados?.pedidos) ? dados.pedidos : [];
}

export function useAprovacaoPedido(
  onSucesso?: (pedidoId: string, acao: "aprovar" | "rejeitar") => void
) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const aprovar = useCallback(
    async (pedidoId: string) => {
      setErro(null);
      setLoadingId(pedidoId);
      try {
        const r = await postAprovacao(pedidoId, "aprovar");
        if (!r.ok) {
          setErro(r.mensagem);
          return false;
        }
        onSucesso?.(pedidoId, "aprovar");
        return true;
      } finally {
        setLoadingId(null);
      }
    },
    [onSucesso]
  );

  const rejeitar = useCallback(
    async (pedidoId: string, motivo: string) => {
      setErro(null);
      if (!motivo.trim()) {
        setErro("Informe o motivo da rejeição.");
        return false;
      }
      setLoadingId(pedidoId);
      try {
        const r = await postAprovacao(pedidoId, "rejeitar", motivo.trim());
        if (!r.ok) {
          setErro(r.mensagem);
          return false;
        }
        onSucesso?.(pedidoId, "rejeitar");
        return true;
      } finally {
        setLoadingId(null);
      }
    },
    [onSucesso]
  );

  return { aprovar, rejeitar, loadingId, erro, setErro };
}
