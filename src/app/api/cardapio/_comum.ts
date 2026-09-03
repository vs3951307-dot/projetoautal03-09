/**
 * Portaria das rotas públicas do cardápio por mesa.
 *
 * Toda rota pública passa por aqui e sai com a mesa JÁ resolvida a partir
 * do token. Nenhuma rota lê `mesaId`/`empresaId` do corpo da requisição:
 * se lesse, um cliente poderia pedir na conta de outra mesa trocando um
 * número no JSON.
 */

import { NextResponse } from "next/server";
import { resolverTokenMesa, type MesaResolvida } from "@/lib/cardapio/tokens";
import { cardapioHabilitado } from "@/lib/cardapio/adapters";
import { verificarLimite, ipDaRequisicao } from "@/lib/rate-limit";

export interface Portaria {
  ok: true;
  mesa: MesaResolvida;
}
export interface PortariaNegada {
  ok: false;
  resposta: NextResponse;
}

/** Mensagem única para qualquer recusa de acesso — não vira oráculo de token. */
const NEGADO = { erro: "Este link do cardápio não é mais válido. Peça o QR Code atualizado ao garçom." };

export async function abrirMesa(
  req: Request,
  entrada: { slug?: unknown; token?: unknown },
  limite: { maximo: number; janelaMs: number } = { maximo: 30, janelaMs: 60_000 }
): Promise<Portaria | PortariaNegada> {
  const slug = typeof entrada.slug === "string" ? entrada.slug : "";
  const token = typeof entrada.token === "string" ? entrada.token : "";
  if (!slug || !token) {
    return { ok: false, resposta: NextResponse.json(NEGADO, { status: 404 }) };
  }

  // Rate limit por token E por IP: o token protege contra um cliente
  // martelando a própria mesa; o IP, contra alguém varrendo tokens.
  const porToken = verificarLimite({ chave: `cardapio:${slug}:${token}`, ...limite });
  const porIp = verificarLimite({ chave: `cardapio-ip:${ipDaRequisicao(req)}`, maximo: limite.maximo * 4, janelaMs: limite.janelaMs });
  if (!porToken.permitido || !porIp.permitido) {
    return {
      ok: false,
      resposta: NextResponse.json({ erro: "Muitas requisições. Aguarde um instante." }, { status: 429 }),
    };
  }

  const mesa = await resolverTokenMesa(slug, token);
  if (!mesa) return { ok: false, resposta: NextResponse.json(NEGADO, { status: 404 }) };

  if (!(await cardapioHabilitado(mesa.empresaId))) {
    return {
      ok: false,
      resposta: NextResponse.json(
        { erro: "O cardápio digital não está ativo neste estabelecimento." },
        { status: 404 }
      ),
    };
  }
  return { ok: true, mesa };
}
