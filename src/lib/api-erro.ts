import { NextRequest, NextResponse } from "next/server";
import { tenantALS } from "@/lib/tenant-context";

const EH_DEV = process.env.NODE_ENV !== "production";

/**
 * Log de erro — detalhes/stack só no servidor.
 * Em produção a resposta ao cliente é sempre genérica.
 */
function redator(texto: string | undefined): string {
  if (!texto) return texto ?? "";
  return texto
    .replace(/postgresql:\/\/[^:\s]+:[^@\s]+@[^\s]+/gi, "postgresql://***:***@***")
    .replace(/(Bearer|ApiKey|Token|Secret|Password|Senha)\s*[:=]\s*[^\s,;"]+/gi, "$1=***")
    .replace(/([?&](key|token|secret|password|senha)=)[^&]+/gi, "$1***")
    .replace(/sk-[a-zA-Z0-9_-]{10,}/g, "sk-***")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "AIza***");
}

export function logErro(contexto: string, erro: unknown, extra?: Record<string, unknown>) {
  const mensagem = redator(erro instanceof Error ? erro.message : String(erro));
  const stack = redator(erro instanceof Error ? erro.stack : undefined);

  if (EH_DEV) {
    console.error(
      `\n========== ERRO REAL — ${contexto} ==========\n` +
        `Mensagem: ${mensagem}\n` +
        (extra ? `Contexto extra: ${JSON.stringify(extra)}\n` : "") +
        (stack ? `Stack:\n${stack}\n` : "") +
        `================================================\n`
    );
    return;
  }

  console.error(
    JSON.stringify({
      nivel: "error",
      contexto,
      mensagem,
      stack,
      timestamp: new Date().toISOString(),
      ...extra,
    })
  );
}

/**
 * Envolve handler de rota: captura exceções, loga no servidor e devolve
 * 500 genérico ao cliente — SEM detalhe interno, Prisma, SQL ou stack.
 */
export function comTratamentoDeErro<T extends unknown[]>(
  nomeRota: string,
  handler: (req: NextRequest, ...args: T) => Promise<Response>
) {
  return async (req: NextRequest, ...args: T): Promise<Response> => {
    try {
      return await tenantALS.run({ contextoTenant: null }, () => handler(req, ...args));
    } catch (erro) {
      logErro(nomeRota, erro, { url: req.nextUrl?.pathname });
      return NextResponse.json(
        { erro: "Erro interno. Tente novamente em instantes." },
        { status: 500 }
      );
    }
  };
}
