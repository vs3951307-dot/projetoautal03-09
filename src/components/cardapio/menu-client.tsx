"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  escopoDoCarrinho,
  obterChaveIdempotencia,
  limparChaveIdempotencia,
} from "@/lib/cardapio/idempotencia-cliente";

/**
 * Cardápio da mesa (cliente).
 *
 * O carrinho vive só aqui, na memória do navegador. Ele NÃO calcula o
 * total oficial: o número mostrado é uma estimativa para orientar quem
 * está pedindo, e o valor que vale é o que o servidor devolve depois de
 * recalcular pelo cadastro. Se os dois divergirem, o servidor está certo.
 */

interface ItemMenu {
  id: string;
  nome: string;
  descricao: string;
  preco: number;
  emoji: string;
  destaque: boolean;
  tamanhos: { nome: string; valor: number }[];
  sabores: { nome: string; tipo: string }[];
}
interface CategoriaMenu {
  nome: string;
  itens: ItemMenu[];
}
interface Comanda {
  numero: number | null;
  total: number;
  aguardandoAprovacao: boolean;
  itens: { nome: string; quantidade: number; tamanho: string | null; total: number }[];
}
interface Dados {
  empresa: { nome: string };
  mesa: { numero: number };
  aviso: string | null;
  aprovacaoManual: boolean;
  categorias: CategoriaMenu[];
  comanda: Comanda;
}

interface LinhaCarrinho {
  uid: string;
  produtoId: string;
  nome: string;
  quantidade: number;
  tamanho: string | null;
  precoEstimado: number;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function MenuClient({
  slug,
  token,
  empresaNome,
  mesaNumero,
}: {
  slug: string;
  token: string;
  empresaNome: string;
  mesaNumero: number;
}) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carrinho, setCarrinho] = useState<LinhaCarrinho[]>([]);
  const [nome, setNome] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [categoriaAtiva, setCategoriaAtiva] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/cardapio/menu?slug=${encodeURIComponent(slug)}&token=${encodeURIComponent(token)}`,
        { cache: "no-store" }
      );
      const corpo = await r.json();
      if (!r.ok) {
        setErro(corpo.erro ?? "Não foi possível abrir o cardápio.");
        return;
      }
      setDados(corpo);
      setErro(null);
      setCategoriaAtiva((atual) => atual ?? corpo.categorias[0]?.nome ?? null);
    } catch {
      setErro("Sem conexão. Tente de novo em instantes.");
    }
  }, [slug, token]);

  useEffect(() => {
    void carregar();
    // A comanda muda quando o garçom lança itens no PDV; recarregar de
    // tempos em tempos mantém a tela honesta sem abrir um socket a mais.
    const timer = setInterval(() => void carregar(), 30_000);
    return () => clearInterval(timer);
  }, [carregar]);

  const totalEstimado = useMemo(
    () => carrinho.reduce((acc, l) => acc + l.precoEstimado * l.quantidade, 0),
    [carrinho]
  );

  function adicionar(item: ItemMenu, tamanho: { nome: string; valor: number } | null) {
    setCarrinho((atual) => {
      const chave = `${item.id}|${tamanho?.nome ?? ""}`;
      const existente = atual.find((l) => l.uid === chave);
      if (existente) {
        return atual.map((l) => (l.uid === chave ? { ...l, quantidade: l.quantidade + 1 } : l));
      }
      return [
        ...atual,
        {
          uid: chave,
          produtoId: item.id,
          nome: item.nome,
          quantidade: 1,
          tamanho: tamanho?.nome ?? null,
          precoEstimado: tamanho?.valor ?? item.preco,
        },
      ];
    });
  }

  function mudarQuantidade(uid: string, delta: number) {
    setCarrinho((atual) =>
      atual
        .map((l) => (l.uid === uid ? { ...l, quantidade: l.quantidade + delta } : l))
        .filter((l) => l.quantidade > 0)
    );
  }

  async function enviarPedido() {
    if (carrinho.length === 0 || enviando) return;
    if (nome.trim().length < 2) {
      setAviso("Diga seu nome para o garçom saber de quem é o pedido.");
      return;
    }
    setEnviando(true);
    setAviso(null);
    // Chave por CARRINHO, não por tentativa: se a resposta se perder, o
    // reenvio leva a MESMA chave e o servidor devolve o mesmo pedido em
    // vez de criar outro. Só é descartada após sucesso confirmado.
    const escopo = escopoDoCarrinho(
      mesaNumero,
      carrinho.map((l) => ({ produtoId: l.produtoId, quantidade: l.quantidade, tamanho: l.tamanho }))
    );
    const idempotencyKey = obterChaveIdempotencia(escopo);
    try {
      const r = await fetch("/api/cardapio/pedidos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          token,
          nomeCliente: nome.trim(),
          idempotencyKey,
          itens: carrinho.map((l) => ({
            produtoId: l.produtoId,
            quantidade: l.quantidade,
            tamanho: l.tamanho,
          })),
        }),
      });
      const corpo = await r.json();
      if (!r.ok) {
        setAviso(corpo.erro ?? "Não foi possível enviar o pedido.");
        return;
      }
      // Só agora a chave pode morrer: o servidor confirmou.
      limparChaveIdempotencia(escopo);
      setCarrinho([]);
      setAviso(corpo.mensagem);
      await carregar();
    } catch {
      // A chave NÃO é limpa aqui: pode ser que o servidor tenha criado o
      // pedido e só a resposta tenha se perdido. Reenviar com a mesma
      // chave devolve o mesmo pedido.
      setAviso("Não recebemos a confirmação. Toque em enviar de novo — não vai duplicar o pedido.");
    } finally {
      setEnviando(false);
    }
  }

  async function chamar(tipo: "garcom" | "conta") {
    try {
      const r = await fetch("/api/cardapio/chamar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, token, tipo }),
      });
      const corpo = await r.json();
      setAviso(r.ok ? corpo.mensagem : (corpo.erro ?? "Não foi possível chamar agora."));
    } catch {
      setAviso("Sem conexão. Tente de novo.");
    }
  }

  if (erro) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-lg font-semibold">{erro}</p>
        <p className="text-sm text-muted-foreground">Chame o garçom para pegar o QR Code atualizado.</p>
      </main>
    );
  }

  if (!dados) {
    return (
      <main className="mx-auto max-w-md p-6">
        <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
        <div className="mt-4 space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </main>
    );
  }

  const categoria = dados.categorias.find((c) => c.nome === categoriaAtiva) ?? dados.categorias[0];

  return (
    <main className="mx-auto max-w-md pb-40">
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <h1 className="text-lg font-bold">{empresaNome}</h1>
        <p className="text-sm text-muted-foreground">Mesa {mesaNumero}</p>
        {dados.aviso ? <p className="mt-1 text-xs text-muted-foreground">{dados.aviso}</p> : null}
      </header>

      {dados.comanda.itens.length > 0 ? (
        <section className="mx-4 mt-4 rounded-lg border p-3">
          <h2 className="text-sm font-semibold">
            Já na comanda{dados.comanda.numero ? ` (pedido #${dados.comanda.numero})` : ""}
          </h2>
          {dados.comanda.aguardandoAprovacao ? (
            <p className="mt-1 text-xs text-amber-600">Aguardando o garçom confirmar.</p>
          ) : null}
          <ul className="mt-2 space-y-1 text-sm">
            {dados.comanda.itens.map((i, idx) => (
              <li key={idx} className="flex justify-between gap-2">
                <span>
                  {i.quantidade}× {i.nome}
                  {i.tamanho ? ` (${i.tamanho})` : ""}
                </span>
                <span className="tabular-nums">{brl(i.total)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex justify-between border-t pt-2 text-sm font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{brl(dados.comanda.total)}</span>
          </p>
        </section>
      ) : null}

      <nav className="mt-4 flex gap-2 overflow-x-auto px-4 pb-2">
        {dados.categorias.map((c) => (
          <button
            key={c.nome}
            onClick={() => setCategoriaAtiva(c.nome)}
            className={`whitespace-nowrap rounded-full border px-3 py-1 text-sm ${
              c.nome === categoria?.nome ? "bg-foreground text-background" : ""
            }`}
          >
            {c.nome}
          </button>
        ))}
      </nav>

      <section className="space-y-3 px-4">
        {categoria?.itens.map((item) => (
          <article key={item.id} className="rounded-lg border p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">
                  {item.emoji} {item.nome}
                </h3>
                {item.descricao ? (
                  <p className="text-sm text-muted-foreground">{item.descricao}</p>
                ) : null}
              </div>
              {item.tamanhos.length <= 1 ? (
                <span className="whitespace-nowrap text-sm tabular-nums">{brl(item.preco)}</span>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {item.tamanhos.length > 1 ? (
                item.tamanhos.map((t) => (
                  <button
                    key={t.nome}
                    onClick={() => adicionar(item, t)}
                    className="rounded-md border px-3 py-1 text-sm"
                  >
                    {t.nome} · {brl(t.valor)}
                  </button>
                ))
              ) : (
                <button
                  onClick={() => adicionar(item, null)}
                  className="rounded-md border px-3 py-1 text-sm"
                >
                  Adicionar
                </button>
              )}
            </div>
            {item.sabores.length > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Sabores e meio a meio: peça ao garçom para montar.
              </p>
            ) : null}
          </article>
        ))}
      </section>

      <div className="fixed inset-x-0 bottom-0 mx-auto max-w-md border-t bg-background p-3">
        {aviso ? <p className="mb-2 text-center text-sm">{aviso}</p> : null}
        {carrinho.length > 0 ? (
          <>
            <ul className="mb-2 max-h-32 space-y-1 overflow-y-auto text-sm">
              {carrinho.map((l) => (
                <li key={l.uid} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {l.nome}
                    {l.tamanho ? ` (${l.tamanho})` : ""}
                  </span>
                  <span className="flex items-center gap-2">
                    <button onClick={() => mudarQuantidade(l.uid, -1)} className="rounded border px-2">
                      −
                    </button>
                    <span className="w-4 text-center tabular-nums">{l.quantidade}</span>
                    <button onClick={() => mudarQuantidade(l.uid, 1)} className="rounded border px-2">
                      +
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Seu nome"
              maxLength={60}
              className="mb-2 w-full rounded-md border px-3 py-2 text-sm"
            />
            <button
              onClick={() => void enviarPedido()}
              disabled={enviando}
              className="w-full rounded-md bg-foreground py-3 font-semibold text-background disabled:opacity-60"
            >
              {enviando ? "Enviando…" : `Enviar pedido · ~${brl(totalEstimado)}`}
            </button>
            <p className="mt-1 text-center text-[11px] text-muted-foreground">
              Valor final confirmado pelo restaurante.
            </p>
          </>
        ) : (
          <div className="flex gap-2">
            <button onClick={() => void chamar("garcom")} className="flex-1 rounded-md border py-3 text-sm">
              Chamar garçom
            </button>
            <button onClick={() => void chamar("conta")} className="flex-1 rounded-md border py-3 text-sm">
              Pedir a conta
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
