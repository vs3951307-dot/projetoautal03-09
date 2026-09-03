/**
 * Disponibilidade de produto por estoque (ficha técnica).
 *
 * Consulta `ProdutoInsumo.quantidadeNecessaria` e o estoque atual.
 * Um produto só pode ser vendido se, para CADA insumo:
 *   estoqueAtual >= quantidadeNecessaria * quantidadeDoPedido
 * e o insumo estiver ativo.
 *
 * Segurança: NÃO decrementa estoque aqui — só lê.
 * O débito real ocorre na transação de criação do pedido
 * (`debitarInsumosDoPedido` em src/lib/pedidos/estoque-pedido.ts).
 */

import { prisma } from "@/lib/prisma";

export interface ResultadoDisponibilidade {
  disponivel: boolean;
  motivo?: string;
  insumos?: {
    nome: string;
    quantidadeAtual: number;
    quantidadeMinima: number;
    quantidadeNecessaria: number;
    quantidadeRequerida: number;
    unidade: string;
  }[];
}

/**
 * Verifica se `quantidade` unidades do produto podem ser fabricadas agora.
 */
export async function verificarDisponibilidade(
  empresaId: string,
  produtoId: string,
  quantidade: number = 1
): Promise<ResultadoDisponibilidade> {
  const qtd = Number.isFinite(quantidade) && quantidade > 0 ? quantidade : 1;

  const vinculos = await prisma.produtoInsumo.findMany({
    where: { empresaId, produtoId },
    include: {
      estoqueProduto: {
        select: {
          id: true,
          nome: true,
          quantidade: true,
          minimo: true,
          unidade: true,
          ativo: true,
        },
      },
    },
  });

  // Sem ficha técnica → disponível (sem controle por ingrediente).
  if (vinculos.length === 0) {
    return { disponivel: true };
  }

  const insumos = vinculos.map((v) => {
    const necessaria = Number(v.quantidadeNecessaria) || 0;
    const requerida = necessaria * qtd;
    return {
      nome: v.estoqueProduto.nome,
      quantidadeAtual: v.estoqueProduto.quantidade,
      quantidadeMinima: v.estoqueProduto.minimo,
      quantidadeNecessaria: necessaria,
      quantidadeRequerida: requerida,
      unidade: v.estoqueProduto.unidade,
    };
  });

  for (const v of vinculos) {
    const ep = v.estoqueProduto;
    const necessaria = Number(v.quantidadeNecessaria) || 0;
    const requerida = necessaria * qtd;

    if (!ep.ativo) {
      return {
        disponivel: false,
        motivo: `${ep.nome} está fora de estoque`,
        insumos,
      };
    }

    // Regra principal: precisa haver insumo suficiente para fabricar a quantidade pedida.
    if (ep.quantidade < requerida) {
      return {
        disponivel: false,
        motivo: `Estoque insuficiente de *${ep.nome}* (precisa ${requerida} ${ep.unidade}, disponível ${ep.quantidade} ${ep.unidade})`,
        insumos,
      };
    }

    // Também respeita mínimo cadastrado após o consumo (se minimo > 0).
    if (ep.minimo > 0 && ep.quantidade - requerida < ep.minimo) {
      return {
        disponivel: false,
        motivo: `Estoque baixo de *${ep.nome}* após o uso (ficaria ${ep.quantidade - requerida} ${ep.unidade}, mínimo ${ep.minimo})`,
        insumos,
      };
    }
  }

  return { disponivel: true, insumos };
}

/**
 * Verifica vários itens de uma vez (útil no resumo do pedido).
 */
export async function verificarDisponibilidadeItens(
  empresaId: string,
  itens: { produtoId: string; quantidade: number; nome?: string }[]
): Promise<{ ok: boolean; problemas: string[] }> {
  const problemas: string[] = [];
  for (const item of itens) {
    const r = await verificarDisponibilidade(empresaId, item.produtoId, item.quantidade);
    if (!r.disponivel) {
      problemas.push(
        `${item.nome || item.produtoId}: ${r.motivo || "indisponível"}`
      );
    }
  }
  return { ok: problemas.length === 0, problemas };
}
