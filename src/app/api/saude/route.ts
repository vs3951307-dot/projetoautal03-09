import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Health check da aplicação — consumido pelo orquestrador do deploy
 * (`healthCheckPath: /api/saude` no render.yaml), pelo nginx/load
 * balancer e por monitores de uptime.
 *
 * CORREÇÃO DE AUDITORIA (risco real de derrubar o deploy):
 * a versão anterior aplicava `verificarLimite({ maximo: 10, janelaMs:
 * 60_000 })` por IP e respondia **429** ao estourar. Duas consequências
 * graves em producao:
 *
 *   1) O Render sonda a rota a cada poucos segundos. A 5s de intervalo
 *      sao 12 chamadas/min - acima do teto de 10. A sonda recebia 429,
 *      o servico era marcado como nao saudavel e entrava em ciclo de
 *      restart / deploy bloqueado.
 *   2) Atras de proxy, todas as sondas chegam com o MESMO
 *      `x-forwarded-for`. Sonda do Render + health check do nginx +
 *      monitor de uptime dividiam o mesmo balde de 10/min.
 *
 * A rota agora NUNCA responde 429. O que sobrava de legitimo na
 * preocupacao original (nao deixar um flood externo martelar o banco
 * com `SELECT 1`) e resolvido sem afetar a sonda: o resultado da
 * checagem e reaproveitado por `JANELA_CACHE_MS` e chamadas
 * simultaneas compartilham a mesma consulta em voo.
 *
 * Contrato preservado: 200 quando o banco responde, 503 quando nao.
 * O corpo nao expoe nada sensivel (sem versao, host, credencial ou
 * mensagem de erro do banco).
 */
export const dynamic = "force-dynamic";

/** Por quanto tempo a ultima checagem de banco e reaproveitada. */
const JANELA_CACHE_MS =
  Number(process.env.SAUDE_CACHE_MS) > 0 ? Number(process.env.SAUDE_CACHE_MS) : 3_000;

interface UltimaChecagem {
  ok: boolean;
  tempoRespostaMs: number;
  verificadoEm: number;
}

let ultima: UltimaChecagem | null = null;
/** Evita que N chamadas simultaneas disparem N consultas ao banco. */
let emVoo: Promise<UltimaChecagem> | null = null;

async function checarBanco(): Promise<UltimaChecagem> {
  const inicio = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, tempoRespostaMs: Date.now() - inicio, verificadoEm: Date.now() };
  } catch {
    return { ok: false, tempoRespostaMs: Date.now() - inicio, verificadoEm: Date.now() };
  }
}

async function estadoDoBanco(): Promise<UltimaChecagem> {
  const agora = Date.now();
  if (ultima && agora - ultima.verificadoEm < JANELA_CACHE_MS) return ultima;
  if (emVoo) return emVoo;
  emVoo = checarBanco()
    .then((resultado) => {
      ultima = resultado;
      return resultado;
    })
    .finally(() => {
      emVoo = null;
    });
  return emVoo;
}

export async function GET() {
  const estado = await estadoDoBanco();

  return NextResponse.json(
    {
      status: estado.ok ? "ok" : "erro",
      banco: estado.ok ? "conectado" : "indisponivel",
      tempoRespostaMs: estado.tempoRespostaMs,
      timestamp: new Date().toISOString(),
    },
    {
      status: estado.ok ? 200 : 503,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    }
  );
}
