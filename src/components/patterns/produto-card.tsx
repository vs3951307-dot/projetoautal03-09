"use client";

import { ChevronRight } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Produto, AdicionalPizza, SaborPizza, SaborDisponivel, SelecaoPizza } from "@/lib/catalogo";
import { PizzaPickerDialog } from "@/app/pdv/_components/pizza-picker-dialog";

interface ProdutoCardProps {
  produto: Produto;
  adicionais?: AdicionalPizza[];
  acrescimoPorSaborPremium?: number;
  permitirMisturarDoceSalgada?: boolean;
  /** Catálogo global de sabores (para meio a meio entre produtos). */
  saboresDisponiveis?: SaborDisponivel[];
  onAdicionar: (produto: Produto, escolha?: SelecaoPizza) => void;
  className?: string;
}

/**
 * ProdutoCard — listagem COMPACTA (listagem do PDV/Garçom): destaca o NOME
 * do produto; tocar no card abre tamanhos/sabores (PizzaPickerDialog) em vez
 * de ocupar a grade com descrição, preço e botão. Nenhum valor comercial é
 * destacado aqui — o preço real é decidido no picker/servidor.
 */
export function ProdutoCard({
  produto,
  adicionais = [],
  acrescimoPorSaborPremium,
  permitirMisturarDoceSalgada,
  saboresDisponiveis,
  onAdicionar,
  className,
}: ProdutoCardProps) {
  const [pickerAberto, setPickerAberto] = React.useState(false);
  const temOpcoes = (produto.sabores?.length ?? 0) > 0 || (produto.tamanhos?.length ?? 0) > 0;

  function abrirOuAdicionar() {
    if (temOpcoes) {
      setPickerAberto(true);
      return;
    }
    onAdicionar(produto);
  }

  function confirmarEscolha(escolha: SelecaoPizza) {
    onAdicionar(produto, escolha);
    setPickerAberto(false);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Adicionar ${produto.nome}`}
      onClick={abrirOuAdicionar}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          abrirOuAdicionar();
        }
      }}
      className={cn(
        "group flex h-full cursor-pointer items-center gap-3 overflow-hidden rounded-xl border border-border bg-card px-3 py-2.5 text-left shadow-card transition-colors hover:border-primary/30 hover:bg-muted/40 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/10",
        className
      )}
    >
      {/* Emoji em tile compacto */}
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-secondary text-2xl">
        {produto.emoji || "🍽️"}
      </div>

      {/* Nome (principal) + dica discreta */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h3 className="truncate text-sm font-semibold leading-tight text-foreground">
            {produto.nome}
          </h3>
          {produto.destaque && (
            <Badge variant="primary" className="shrink-0">
              Destaque
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {temOpcoes ? "Toque para escolher tamanho e sabores" : "Toque para adicionar"}
        </p>
      </div>

      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />

      <PizzaPickerDialog
        open={pickerAberto}
        onOpenChange={setPickerAberto}
        produto={produto}
        adicionais={adicionais}
        acrescimoPorSaborPremium={acrescimoPorSaborPremium}
        permitirMisturarDoceSalgada={permitirMisturarDoceSalgada}
        saboresDisponiveis={saboresDisponiveis}
        onConfirmar={confirmarEscolha}
      />
    </div>
  );
}
