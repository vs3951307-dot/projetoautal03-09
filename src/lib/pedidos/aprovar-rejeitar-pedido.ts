/**
 * Aprovar ou rejeitar um pedido feito pelo cliente no cardápio digital.
 *
 * Não cria pedido: `criarPedido` continua sendo a única porta de entrada.
 * O pedido já NASCE com `producao = "aguardando_aprovacao"` dentro da
 * transação de criação (ver `producaoInicialDe` em `criar-pedido.ts`), e
 * é este serviço que o tira de lá.
 *
 * Enquanto está aguardando, o pedido não vai para o KDS nem para a
 * impressão — quem barra isso é `/api/pedidos/route.ts`. Aprovar aqui é o
 * ÚNICO caminho que dispara cozinha e comanda impressa para esses pedidos.
 *
 * Ajustes em relação ao esboço original, para bater com o schema real:
 *  - `Pedido` não tem campo `andamento`; o que existe é `status`
 *    (andamento | concluido | cancelado | ...) e `producao` (recebido →
 *    em_preparo → pronto → finalizado).
 *  - Não existe `producao = "cancelado"`. Rejeitar é o mesmo que cancelar:
 *    `status: "cancelado"` + `producao: "finalizado"`, igual ao que
 *    `/api/pedidos/[id]` já faz.
 *  - `Auditoria` não tem `entidade`/`entidadeId`/`meta`; tem `acao`,
 *    `detalhe`, `estadoAnterior` e `estadoNovo`.
 *  - Rejeitar DEVOLVE os insumos. `criarPedido` debita a ficha técnica na
 *    criação; sem o estorno, todo pedido recusado consumiria ingredientes
 *    de verdade.
 */

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/acesso";
import { estornarInsumosDoPedido } from "@/lib/pedidos/estoque-pedido";
import { emitirMudancaKds } from "@/lib/kds-eventos";
import { emitirEventoTempoReal } from "@/lib/eventos-tempo-real";
import {
  enfileirarAutomatica,
  gerarConteudoPedido,
  referenciaPedido,
  tipoParaCanalPedido,
  lerImpressoras,
  destinoRealDoTipo,
} from "@/lib/impressao";

/** Alinhado à allowlist de `producaoInicial` em `criar-pedido.ts`. */
export const PRODUCAO_AGUARDANDO = "aguardando_aprovacao";
const PRODUCAO_RECEBIDO = "recebido";

const inputSchema = z.object({
  empresaId: z.string().min(1),
  pedidoId: z.string().min(1),
  acao: z.enum(["aprovar", "rejeitar"]),
  motivo: z.string().max(300).optional(),
  usuario: z.object({ id: z.string(), nome: z.string() }).optional(),
});

export type AprovarRejeitarInput = z.input<typeof inputSchema>;

export type AprovarRejeitarResultado =
  | {
      ok: true;
      acao: "aprovar" | "rejeitar";
      pedidoId: string;
      numero: number;
      producao: string;
      status: string;
    }
  | { ok: false; codigo: string; mensagem: string };

/**
 * Detecção de conflito por FORMA, nunca `instanceof`: a classe de erro do
 * Prisma vem por cópia do módulo e o `instanceof` falha entre realms.
 */
function ehConflitoPrisma(erro: unknown): boolean {
  if (typeof erro !== "object" || erro === null) return false;
  const codigo = (erro as { code?: unknown }).code;
  return codigo === "P2002" || codigo === "P2034";
}

export async function aprovarOuRejeitarPedido(
  raw: AprovarRejeitarInput
): Promise<AprovarRejeitarResultado> {
  const input = inputSchema.parse(raw);

  if (input.acao === "rejeitar" && !input.motivo?.trim()) {
    return {
      ok: false,
      codigo: "MOTIVO_OBRIGATORIO",
      mensagem: "Informe o motivo da rejeição.",
    };
  }

  try {
    const resultado = await prisma.$transaction(async (tx) => {
      const pedido = await tx.pedido.findFirst({
        // `empresaId` no filtro é obrigatório mesmo com schema por tenant:
        // defesa em profundidade contra id de pedido de outra empresa.
        where: { id: input.pedidoId, empresaId: input.empresaId },
        select: {
          id: true,
          numero: true,
          canal: true,
          status: true,
          producao: true,
          mesaId: true,
          total: true,
        },
      });
      if (!pedido) return { tipo: "nao_encontrado" as const };
      if (pedido.producao !== PRODUCAO_AGUARDANDO) {
        return { tipo: "estado_invalido" as const, producao: pedido.producao };
      }

      if (input.acao === "aprovar") {
        // `updateMany` com o estado ANTERIOR no `where`: dois atendentes
        // aprovando ao mesmo tempo — o segundo altera 0 linhas e recebe
        // ESTADO_INVALIDO, em vez de disparar a cozinha duas vezes.
        const alterou = await tx.pedido.updateMany({
          where: { id: pedido.id, empresaId: input.empresaId, producao: PRODUCAO_AGUARDANDO },
          data: { producao: PRODUCAO_RECEBIDO, recebidoEm: new Date() },
        });
        if (alterou.count === 0) {
          return { tipo: "estado_invalido" as const, producao: PRODUCAO_RECEBIDO };
        }
        return { tipo: "aprovado" as const, pedido };
      }

      const alterou = await tx.pedido.updateMany({
        where: { id: pedido.id, empresaId: input.empresaId, producao: PRODUCAO_AGUARDANDO },
        data: { status: "cancelado", producao: "finalizado", finalizadoEm: new Date() },
      });
      if (alterou.count === 0) {
        return { tipo: "estado_invalido" as const, producao: pedido.producao };
      }

      // Estorno da ficha técnica: `criarPedido` debitou os insumos na
      // criação. Sem isto, recusar um pedido consumiria ingredientes.
      const itens = await tx.itemPedido.findMany({
        where: { pedidoId: pedido.id },
        select: { produtoId: true, quantidade: true },
      });
      await estornarInsumosDoPedido(tx, input.empresaId, itens);

      // Libera a mesa SOMENTE se não sobrar outro pedido ativo nela — uma
      // mesa pode ter dois pedidos do cardápio em sequência, e o segundo
      // não pode "esconder" o primeiro voltando a mesa para livre.
      let mesaLiberada = false;
      if (pedido.mesaId !== null) {
        const outroAtivo = await tx.pedido.findFirst({
          where: {
            empresaId: input.empresaId,
            mesaId: pedido.mesaId,
            id: { not: pedido.id },
            status: { not: "cancelado" },
          },
          select: { id: true },
        });
        if (!outroAtivo) {
          await tx.mesa.update({ where: { id: pedido.mesaId }, data: { status: "livre" } });
          mesaLiberada = true;
        }
      }

      return { tipo: "rejeitado" as const, pedido, mesaLiberada };
    });

    if (resultado.tipo === "nao_encontrado") {
      return { ok: false, codigo: "PEDIDO_NAO_ENCONTRADO", mensagem: "Pedido não encontrado." };
    }
    if (resultado.tipo === "estado_invalido") {
      return {
        ok: false,
        codigo: "ESTADO_INVALIDO",
        mensagem: `Este pedido não está aguardando aprovação (produção: ${resultado.producao}).`,
      };
    }

    const { pedido } = resultado;
    const aprovado = resultado.tipo === "aprovado";

    await registrarAuditoria(
      aprovado ? "pedido_aprovado" : "pedido_rejeitado",
      aprovado
        ? `Pedido #${pedido.numero} aprovado e liberado para a cozinha.`
        : `Pedido #${pedido.numero} rejeitado. Motivo: ${input.motivo}`,
      input.usuario ?? null,
      undefined,
      input.empresaId
    );

    // Efeitos de cozinha SÓ depois de aprovar, e com as MESMAS funções que
    // `/api/pedidos` usa no pedido normal — nada de segundo caminho de
    // impressão. Fora da transação e em try/catch: o pedido já está
    // aprovado no banco, e uma falha de impressora não pode desfazer isso.
    if (aprovado) {
      try {
        emitirMudancaKds(input.empresaId);
        emitirEventoTempoReal(input.empresaId, "pedido");
      } catch (erro) {
        console.warn(`Aviso de KDS falhou para o pedido ${pedido.id} (já aprovado):`, erro);
      }
      try {
        const impressoras = await lerImpressoras(input.empresaId);
        const tipoCanal = tipoParaCanalPedido(pedido.canal);
        if (tipoCanal !== "pedido-cozinha") {
          const conteudo = await gerarConteudoPedido(input.empresaId, pedido.numero, tipoCanal);
          if (conteudo) {
            await enfileirarAutomatica(input.empresaId, {
              tipo: tipoCanal,
              destino: destinoRealDoTipo(tipoCanal, impressoras),
              referencia: referenciaPedido(pedido.numero),
              conteudo,
            });
          }
        }
        const conteudoCozinha = await gerarConteudoPedido(
          input.empresaId,
          pedido.numero,
          "pedido-cozinha"
        );
        if (conteudoCozinha) {
          await enfileirarAutomatica(input.empresaId, {
            tipo: "pedido-cozinha",
            destino:
              pedido.canal === "salao"
                ? destinoRealDoTipo("pedido-cozinha", impressoras)
                : "cozinha",
            referencia: referenciaPedido(pedido.numero),
            conteudo: conteudoCozinha,
          });
        }
      } catch (erro) {
        console.warn(`Impressão falhou para o pedido ${pedido.id} (já aprovado):`, erro);
      }
    } else {
      try {
        emitirEventoTempoReal(input.empresaId, "pedido");
        if (resultado.mesaLiberada) emitirEventoTempoReal(input.empresaId, "mesa");
      } catch {
        // aviso em tempo real nunca derruba a rejeição já gravada
      }
    }

    return {
      ok: true,
      acao: input.acao,
      pedidoId: pedido.id,
      numero: pedido.numero,
      producao: aprovado ? PRODUCAO_RECEBIDO : "finalizado",
      status: aprovado ? pedido.status : "cancelado",
    };
  } catch (erro) {
    if (ehConflitoPrisma(erro)) {
      return {
        ok: false,
        codigo: "CONFLITO",
        mensagem: "Outra pessoa está mexendo neste pedido agora. Tente de novo.",
      };
    }
    throw erro;
  }
}

/** Pedidos aguardando aprovação, para o painel do salão. */
export async function listarAguardandoAprovacao(empresaId: string) {
  return prisma.pedido.findMany({
    where: { empresaId, producao: PRODUCAO_AGUARDANDO, status: { not: "cancelado" } },
    orderBy: { criadoEm: "asc" },
    select: {
      id: true,
      numero: true,
      canal: true,
      mesaId: true,
      clienteNome: true,
      total: true,
      criadoEm: true,
      itens: {
        select: { nome: true, quantidade: true, tamanho: true, sabores: true, observacao: true },
      },
    },
  });
}
