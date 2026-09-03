/**
 * Débito transacional de insumos (ficha técnica) ao criar pedido.
 *
 * Deve ser chamado DENTRO de `prisma.$transaction` com o client `tx`.
 * Usa update condicional (quantidade >= requerida) para evitar corrida
 * entre dois pedidos consumindo o último estoque.
 */

import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export class EstoqueInsuficienteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EstoqueInsuficienteError";
  }
}

/**
 * Para cada item do pedido, debita insumos conforme ProdutoInsumo.
 * Se algum insumo não couber, lança EstoqueInsuficienteError (rollback da tx).
 */
export async function debitarInsumosDoPedido(
  tx: Tx,
  empresaId: string,
  itens: { produtoId: string; quantidade: number; nome?: string }[],
  responsavel: string = "sistema-pedido"
): Promise<void> {
  // Agrega necessidade por estoqueProdutoId (vários itens podem usar o mesmo insumo)
  const necessidade = new Map<string, { nome: string; total: number; unidade: string }>();

  for (const item of itens) {
    const qtd = Number(item.quantidade) || 0;
    if (qtd <= 0) continue;

    const vinculos = await tx.produtoInsumo.findMany({
      where: { empresaId, produtoId: item.produtoId },
      include: {
        estoqueProduto: { select: { id: true, nome: true, unidade: true, ativo: true } },
      },
    });

    for (const v of vinculos) {
      if (!v.estoqueProduto.ativo) {
        throw new EstoqueInsuficienteError(
          `${v.estoqueProduto.nome} está inativo e é necessário para ${item.nome || "o produto"}.`
        );
      }
      const req = (Number(v.quantidadeNecessaria) || 0) * qtd;
      if (req <= 0) continue;
      const atual = necessidade.get(v.estoqueProdutoId);
      if (atual) {
        atual.total += req;
      } else {
        necessidade.set(v.estoqueProdutoId, {
          nome: v.estoqueProduto.nome,
          total: req,
          unidade: v.estoqueProduto.unidade,
        });
      }
    }
  }

  for (const [estoqueProdutoId, info] of necessidade) {
    // Update atômico: só debita se houver quantidade suficiente
    const res = await tx.estoqueProduto.updateMany({
      where: {
        id: estoqueProdutoId,
        empresaId,
        ativo: true,
        quantidade: { gte: info.total },
      },
      data: {
        quantidade: { decrement: info.total },
      },
    });

    if (res.count !== 1) {
      // Lê saldo atual para mensagem clara
      const ep = await tx.estoqueProduto.findFirst({
        where: { id: estoqueProdutoId, empresaId },
        select: { quantidade: true, nome: true, unidade: true },
      });
      const disp = ep?.quantidade ?? 0;
      throw new EstoqueInsuficienteError(
        `Estoque insuficiente de ${info.nome}: precisa ${info.total} ${info.unidade}, disponível ${disp} ${info.unidade || ""}.`
      );
    }

    await tx.movimentacaoEstoque.create({
      data: {
        empresaId,
        produtoId: estoqueProdutoId,
        tipo: "saida",
        quantidade: info.total,
        responsavel,
        fornecedor: null,
        valorTotal: null,
      },
    });
  }
}

/**
 * Devolve ao estoque os insumos debitados por um pedido — CORREÇÃO DE
 * AUDITORIA (bug confirmado: o cancelamento perdia estoque para sempre).
 *
 * O QUE ESTAVA ERRADO: `criarPedido()` debita a ficha técnica dentro da
 * transação de criação, mas NENHUM caminho de cancelamento devolvia nada.
 * Cada pedido cancelado sumia com os ingredientes de forma permanente e
 * silenciosa. Num restaurante que controla muçarela em quilos, poucas
 * semanas de cancelamentos normais já deixam o estoque do sistema sem
 * relação com a prateleira — e o alerta de estoque mínimo dispara errado.
 *
 * REGRA DELIBERADAMENTE CONSERVADORA: só devolve quando a produção ainda
 * está em `recebido`, isto é, quando a cozinha NÃO começou a fazer o item.
 * Se o preparo já começou, os ingredientes realmente foram consumidos e
 * devolvê-los seria inventar estoque que não existe. Essa é a única
 * interpretação que não erra para nenhum dos dois lados.
 *
 * IDEMPOTÊNCIA: quem chama garante que o pedido ainda NÃO estava
 * cancelado (a transação de cancelamento usa `updateMany` com
 * `status: { not: "cancelado" }`), então um duplo clique em "cancelar"
 * não devolve o estoque duas vezes.
 */
export async function estornarInsumosDoPedido(
  tx: Tx,
  empresaId: string,
  itens: { produtoId: string; quantidade: number }[]
): Promise<void> {
  const devolucao = new Map<string, number>();

  for (const item of itens) {
    const qtd = Number(item.quantidade) || 0;
    if (qtd <= 0) continue;

    const vinculos = await tx.produtoInsumo.findMany({
      where: { empresaId, produtoId: item.produtoId },
      select: { estoqueProdutoId: true, quantidadeNecessaria: true },
    });

    for (const v of vinculos) {
      const req = (Number(v.quantidadeNecessaria) || 0) * qtd;
      if (req <= 0) continue;
      devolucao.set(v.estoqueProdutoId, (devolucao.get(v.estoqueProdutoId) ?? 0) + req);
    }
  }

  for (const [estoqueProdutoId, total] of devolucao) {
    // `increment` é resolvido pelo Postgres (UPDATE ... SET q = q + n),
    // então duas devoluções simultâneas não se sobrescrevem.
    // O filtro por `empresaId` impede devolver estoque de outro tenant
    // mesmo que um id vazasse de algum lugar.
    await tx.estoqueProduto.updateMany({
      where: { id: estoqueProdutoId, empresaId },
      data: { quantidade: { increment: total } },
    });
  }
}
