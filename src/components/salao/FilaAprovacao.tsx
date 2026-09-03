"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useAprovacaoPedido,
  buscarFilaAprovacao,
  type PedidoAguardando,
} from "@/lib/pedidos/usar-aprovacao-pedido";
import { BotaoAprovarRejeitar } from "./BotaoAprovarRejeitar";

/**
 * Fila de pedidos do cardápio digital aguardando aprovação do salão.
 *
 * Usa a rota real e testada `GET /api/pedidos/aguardando`
 * (`listarAguardandoAprovacao`) — não inventa outra consulta. Poll simples
 * a cada 5s, no mesmo padrão que o cardápio do cliente já usa para
 * atualizar a comanda; sem abrir mais um socket.
 */
/** Tentativas de poll seguidas antes de avisar que a fila está parada. */
const FALHAS_ATE_AVISAR = 3;

export function FilaAprovacao({ pollMs = 5000 }: { pollMs?: number }) {
  const [lista, setLista] = useState<PedidoAguardando[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);

  /**
   * Ids já confirmados pelo servidor nesta montagem da tela.
   *
   * BUG QUE ISTO CORRIGE: `removerLocal` tirava o pedido da lista, mas o
   * poll de 5s fazia `setLista(pedidos)` com a resposta do servidor. Se o
   * poll partisse antes do commit ficar visível (ou trouxesse resposta em
   * cache), o pedido REAPARECIA clicável e o operador aprovava de novo.
   */
  const processados = useRef<Set<string>>(new Set());

  const removerLocal = useCallback((pedidoId: string) => {
    processados.current.add(pedidoId);
    setLista((prev) => prev.filter((p) => p.id !== pedidoId));
  }, []);

  const { aprovar, rejeitar, loadingId, erro, setErro } = useAprovacaoPedido((pedidoId) =>
    removerLocal(pedidoId)
  );

  /**
   * Falhas de poll consecutivas. Uma falha isolada continua silenciosa (não
   * faz sentido piscar erro a cada 5s por instabilidade passageira), mas o
   * silêncio permanente era pior: com a rede caída o operador olhava uma
   * fila CONGELADA achando que não havia pedido nenhum entrando. Depois de
   * FALHAS_ATE_AVISAR tentativas seguidas, a tela avisa que está desatualizada.
   */
  const falhasSeguidas = useRef(0);

  const carregar = useCallback(async () => {
    try {
      const pedidos = await buscarFilaAprovacao();
      setLista(pedidos.filter((p) => !processados.current.has(p.id)));
      falhasSeguidas.current = 0;
      setErroCarga(null);
    } catch {
      falhasSeguidas.current += 1;
      if (falhasSeguidas.current >= FALHAS_ATE_AVISAR) {
        setErroCarga(
          "Sem conexão com o servidor. Esta lista pode estar desatualizada."
        );
      }
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
    const t = setInterval(carregar, pollMs);
    return () => clearInterval(t);
  }, [carregar, pollMs]);

  if (carregando) {
    return <div className="p-3 text-sm text-muted-foreground">Carregando aprovações…</div>;
  }

  if (lista.length === 0) {
    return (
      <div className="p-3 text-sm text-muted-foreground">
        Nenhum pedido aguardando aprovação.
      </div>
    );
  }

  return (
    <div className="space-y-3 p-2">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-semibold text-orange-500">
          Aguardando aprovação ({lista.length})
        </h3>
      </div>

      {erroCarga && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {erroCarga}
        </div>
      )}

      {erro && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <span>{erro}</span>
          <button type="button" className="underline" onClick={() => setErro(null)}>
            Fechar
          </button>
        </div>
      )}

      {lista.map((p) => (
        <BotaoAprovarRejeitar
          key={p.id}
          pedido={p}
          loading={loadingId === p.id}
          onAprovar={aprovar}
          onRejeitar={rejeitar}
        />
      ))}
    </div>
  );
}
