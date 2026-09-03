"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { PedidoAguardando } from "@/lib/pedidos/usar-aprovacao-pedido";

function brl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function BotaoAprovarRejeitar({
  pedido,
  loading,
  onAprovar,
  onRejeitar,
}: {
  pedido: PedidoAguardando;
  loading: boolean;
  onAprovar: (id: string) => Promise<boolean>;
  onRejeitar: (id: string, motivo: string) => Promise<boolean>;
}) {
  const [mostrarMotivo, setMostrarMotivo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const resumoItens = pedido.itens
    .map((i) => `${i.quantidade}× ${i.nome}${i.tamanho ? ` (${i.tamanho})` : ""}`)
    .join(", ");

  return (
    <div className="rounded-xl border p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            Pedido #{pedido.numero}
            {pedido.mesaId != null && (
              <span className="ml-2 text-orange-500">
                Mesa {String(pedido.mesaId).padStart(2, "0")}
              </span>
            )}
          </p>
          {pedido.clienteNome && (
            <p className="text-xs text-muted-foreground">{pedido.clienteNome}</p>
          )}
          {resumoItens && (
            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{resumoItens}</p>
          )}
        </div>
        <p className="whitespace-nowrap text-sm font-bold text-orange-500">
          {brl(Number(pedido.total))}
        </p>
      </div>

      {!mostrarMotivo ? (
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            className="flex-1"
            disabled={loading}
            onClick={() => onAprovar(pedido.id)}
          >
            {loading ? "…" : "Aprovar"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="flex-1"
            disabled={loading}
            onClick={() => setMostrarMotivo(true)}
          >
            Rejeitar
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo da rejeição (obrigatório)"
            rows={2}
            className="w-full rounded-lg border bg-transparent p-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="flex-1"
              disabled={loading}
              onClick={async () => {
                const ok = await onRejeitar(pedido.id, motivo);
                if (ok) {
                  setMostrarMotivo(false);
                  setMotivo("");
                }
              }}
            >
              Confirmar rejeição
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={loading}
              onClick={() => {
                setMostrarMotivo(false);
                setMotivo("");
              }}
            >
              Voltar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
