"use client";

import * as React from "react";
import { QrCode, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CodigoQr } from "@/components/patterns/codigo-qr";

/**
 * QR Code do cardápio digital de UMA mesa.
 *
 * Reaproveita o `CodigoQr` que já existe (biblioteca `qrcode`, geração
 * local) — nenhuma dependência nova e nenhum serviço externo recebendo o
 * link das mesas do cliente.
 *
 * O botão de regenerar é destrutivo de propósito: o QR impresso e
 * qualquer print que um cliente tenha guardado param de funcionar na
 * hora. É o que se quer quando alguém sai do restaurante e continua
 * lançando pedidos na conta da mesa.
 */
export function QrCodeMesa({ numero }: { numero: number }) {
  const [aberto, setAberto] = React.useState(false);
  const [url, setUrl] = React.useState<string | null>(null);
  const [carregando, setCarregando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  const buscar = React.useCallback(
    async (regenerar: boolean) => {
      setCarregando(true);
      setErro(null);
      try {
        const r = await fetch(`/api/cardapio/mesas/${numero}/token`, {
          method: regenerar ? "POST" : "GET",
        });
        const corpo = await r.json();
        if (!r.ok) {
          setErro(corpo.erro ?? "Não foi possível gerar o QR Code.");
          return;
        }
        setUrl(corpo.url);
      } catch {
        setErro("Sem conexão com o servidor.");
      } finally {
        setCarregando(false);
      }
    },
    [numero]
  );

  React.useEffect(() => {
    if (aberto && !url) void buscar(false);
  }, [aberto, url, buscar]);

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <QrCode className="h-4 w-4" aria-hidden="true" />
          QR
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Cardápio da mesa {String(numero).padStart(2, "0")}</DialogTitle>
          <DialogDescription>
            Imprima e deixe na mesa. O cliente escaneia e pede pelo celular.
          </DialogDescription>
        </DialogHeader>

        {erro ? <p className="text-sm text-destructive">{erro}</p> : null}

        {url ? (
          <div className="flex flex-col items-center gap-3">
            <CodigoQr valor={url} tamanho={220} />
            <p className="break-all text-center text-xs text-muted-foreground">{url}</p>
            <div className="flex w-full gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => void navigator.clipboard.writeText(url)}
              >
                Copiar link
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => window.print()}>
                Imprimir
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={carregando}
              onClick={() => void buscar(true)}
              className="text-muted-foreground"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Gerar novo QR (invalida o atual)
            </Button>
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {carregando ? "Gerando…" : "—"}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
