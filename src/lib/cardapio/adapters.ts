/**
 * Camada de adaptadores do Cardápio Digital por mesa.
 *
 * REGRA DA INTEGRAÇÃO: nada em `src/app/cardapio`, `src/app/api/cardapio`
 * ou `src/components/cardapio` importa `@/lib/prisma`. Tudo passa por
 * aqui, e daqui em diante são os SERVIÇOS que já existem no PedidoFlow —
 * `criarPedido`, `listarProdutosDisponiveis`, `emitirMudancaKds` — e não
 * uma segunda implementação do mesmo negócio.
 *
 * Consequências práticas:
 *  - preço, taxa e total são calculados por `criarPedido`, nunca aqui e
 *    nunca no navegador do cliente;
 *  - o bloqueio operacional da Central da IA ("hoje não temos X") já vale
 *    para o cardápio, porque ele lê o MESMO `listarProdutosDisponiveis`;
 *  - a comanda da mesa continua sendo o Pedido `canal: "salao"` — não
 *    existe tabela `Tab` paralela.
 */

import { prisma } from "@/lib/prisma";
import { criarPedido } from "@/lib/pedidos/criar-pedido";
import { listarProdutosDisponiveis, type ProdutoAtendimento } from "@/lib/atendente/catalogo";
import { verificarDisponibilidade } from "@/lib/atendente/disponibilidade";
import { emitirEventoTempoReal } from "@/lib/eventos-tempo-real";
import { emitirMudancaKds } from "@/lib/kds-eventos";
import { parseModulos, modulosPadraoDoPlano } from "@/lib/modulos";
import type { MesaResolvida } from "@/lib/cardapio/tokens";

export const CHAVE_CONFIG_CARDAPIO = "cardapio_mesa";

export interface ConfigCardapio {
  /** O cardápio por QR está ligado nesta empresa. */
  ativo: boolean;
  /**
   * Pedido do cliente entra como PENDENTE e só vai para a cozinha depois
   * que alguém do salão confirma. Padrão `true`: mandar direto para a
   * produção significa que qualquer trote na mesa vira comida feita.
   */
  aprovacaoManual: boolean;
  /** Texto livre exibido no topo do cardápio (ex.: "Wi-Fi: ..."). */
  aviso?: string;
}

const CONFIG_PADRAO: ConfigCardapio = { ativo: false, aprovacaoManual: true };

export async function lerConfigCardapio(empresaId: string): Promise<ConfigCardapio> {
  const registro = await prisma.configuracao.findUnique({
    where: { empresaId_chave: { empresaId, chave: CHAVE_CONFIG_CARDAPIO } },
  });
  if (!registro?.valor) return CONFIG_PADRAO;
  try {
    const dados = JSON.parse(registro.valor) as Partial<ConfigCardapio>;
    return {
      ativo: dados.ativo === true,
      aprovacaoManual: dados.aprovacaoManual !== false,
      aviso: typeof dados.aviso === "string" ? dados.aviso : undefined,
    };
  } catch {
    return CONFIG_PADRAO;
  }
}

/**
 * O cardápio só responde se a empresa tem o módulo `mesas` contratado E a
 * configuração ligada. Duas chaves, como no resto do sistema: módulo diz
 * "a empresa contratou", configuração diz "a empresa quer usar agora".
 */
export async function cardapioHabilitado(empresaId: string): Promise<boolean> {
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { modulos: true, plano: true },
  });
  if (!empresa) return false;
  const modulos = parseModulos(empresa.modulos);
  const efetivos = modulos.length > 0 ? modulos : modulosPadraoDoPlano(empresa.plano);
  if (!efetivos.includes("mesas")) return false;
  return (await lerConfigCardapio(empresaId)).ativo;
}

/* --------------------------------- Menu ----------------------------------- */

export interface ItemMenu {
  id: string;
  nome: string;
  descricao: string;
  preco: number;
  categoria: string;
  emoji: string;
  fotoUrl: string | null;
  destaque: boolean;
  tamanhos: { nome: string; valor: number }[];
  sabores: { nome: string; tipo: string }[];
}

export interface CategoriaMenu {
  nome: string;
  itens: ItemMenu[];
}

/**
 * Cardápio da empresa, agrupado por categoria.
 *
 * Reaproveita `listarProdutosDisponiveis` — o mesmo que o atendente de
 * WhatsApp usa. Ganha de graça: filtro por `ativo`, e o bloqueio
 * operacional temporário da Central da IA.
 */
export async function getMenu(empresaId: string): Promise<CategoriaMenu[]> {
  const produtos: ProdutoAtendimento[] = await listarProdutosDisponiveis(empresaId);
  const porCategoria = new Map<string, ItemMenu[]>();
  for (const p of produtos) {
    const item: ItemMenu = {
      id: p.id,
      nome: p.nome,
      descricao: p.descricao,
      preco: p.precoBase,
      categoria: p.categoria,
      emoji: p.emoji,
      fotoUrl: p.fotoUrl,
      destaque: p.destaque,
      tamanhos: p.tamanhos.map((t) => ({ nome: t.nome, valor: t.valor })),
      sabores: p.sabores,
    };
    const atual = porCategoria.get(p.categoria) ?? [];
    atual.push(item);
    porCategoria.set(p.categoria, atual);
  }
  return [...porCategoria.entries()].map(([nome, itens]) => ({ nome, itens }));
}

/* -------------------------------- Pedido ---------------------------------- */

export interface ItemDoCliente {
  produtoId: string;
  quantidade: number;
  tamanho?: string | null;
  sabores?: string[];
  adicionais?: { nome: string }[];
  observacao?: string | null;
}

export interface ResultadoPedidoMesa {
  ok: boolean;
  status: number;
  erro?: string;
  pedidoId?: string;
  numero?: number;
  total?: number;
  aguardandoAprovacao?: boolean;
  idempotente?: boolean;
}

/** Usuário sintético: o pedido não vem de um funcionário logado. */
function usuarioDoCardapio(mesaNumero: number) {
  return {
    id: "cardapio-mesa",
    nome: `Cardápio da mesa ${mesaNumero}`,
    papel: "CARDAPIO_MESA",
  };
}

/**
 * Cria o pedido da mesa usando o MESMO serviço do PDV e do garçom.
 *
 * O que o cliente manda: produtoId, quantidade, tamanho, sabores,
 * adicionais e observação. O que o cliente NÃO manda: preço. `criarPedido`
 * ignora qualquer preço recebido, recalcula pelo cadastro e rejeita
 * produto que não seja da empresa da mesa.
 */
export async function criarPedidoDaMesa(
  mesa: MesaResolvida,
  dados: {
    nomeCliente: string;
    idempotencyKey: string;
    itens: ItemDoCliente[];
    observacao?: string | null;
  }
): Promise<ResultadoPedidoMesa> {
  if (!Array.isArray(dados.itens) || dados.itens.length === 0) {
    return { ok: false, status: 400, erro: "Escolha pelo menos um item antes de enviar." };
  }
  if (dados.itens.length > 50) {
    return { ok: false, status: 400, erro: "Pedido com itens demais. Chame o garçom." };
  }

  // Disponibilidade real (ficha técnica/estoque) ANTES de criar o pedido.
  for (const item of dados.itens) {
    const disp = await verificarDisponibilidade(mesa.empresaId, item.produtoId, item.quantidade);
    if (!disp.disponivel) {
      return {
        ok: false,
        status: 409,
        erro: `Um dos itens acabou de ficar indisponível. ${disp.motivo ?? ""}`.trim(),
      };
    }
  }

  const config = await lerConfigCardapio(mesa.empresaId);

  const resultado = await criarPedido(mesa.empresaId, usuarioDoCardapio(mesa.mesaNumero), {
    canal: "salao",
    // Estado inicial vai JUNTO com a criação. Antes o pedido nascia
    // "recebido" e só depois virava "aguardando_aprovacao" — nessa janela
    // ele já era um pedido normal para o KDS e para a impressão.
    producaoInicial: config.aprovacaoManual ? "aguardando_aprovacao" : "recebido",
    mesaId: mesa.mesaNumero,
    clienteNome: dados.nomeCliente.slice(0, 60),
    origem: "cardapio_mesa",
    observacao: dados.observacao ?? null,
    idempotencyKey: dados.idempotencyKey,
    itens: dados.itens.map((i) => ({
      produtoId: i.produtoId,
      quantidade: Math.max(1, Math.min(50, Number(i.quantidade) || 1)),
      tamanho: i.tamanho ?? null,
      sabores: i.sabores ?? [],
      adicionais: (i.adicionais ?? []).map((a) => ({ nome: a.nome })),
      observacao: i.observacao ?? null,
    })),
  });

  if (!resultado.ok) {
    return { ok: false, status: resultado.status, erro: resultado.erro };
  }

  // Reenvio da mesma chave: nada de novo aconteceu, e nada é reemitido.
  if (resultado.idempotente) {
    return {
      ok: true,
      status: 200,
      idempotente: true,
      pedidoId: resultado.pedido.id,
      numero: resultado.pedido.numero,
      total: resultado.pedido.total,
      aguardandoAprovacao: config.aprovacaoManual,
    };
  }

  await marcarMesa(mesa, "pedido_enviado");
  emitirEventoTempoReal(mesa.empresaId, "pedido");
  if (!config.aprovacaoManual) emitirMudancaKds(mesa.empresaId);

  return {
    ok: true,
    status: 201,
    pedidoId: resultado.pedido.id,
    numero: resultado.pedido.numero,
    total: resultado.pedido.total,
    aguardandoAprovacao: config.aprovacaoManual,
  };
}

/* ---------------------------- Chamar garçom ------------------------------- */

export type TipoChamada = "garcom" | "conta";

/**
 * Chamar garçom / pedir a conta.
 *
 * Usa `Mesa.status`, que o painel de mesas já lê e já exibe
 * (`aguardando` e `conta` são estados existentes). Sem tabela nova e sem
 * uma segunda fila de notificações para alguém esquecer de olhar.
 */
export async function chamarGarcom(mesa: MesaResolvida, tipo: TipoChamada): Promise<void> {
  await marcarMesa(mesa, tipo === "conta" ? "conta" : "aguardando");
  emitirEventoTempoReal(mesa.empresaId, "mesa");
}

async function marcarMesa(mesa: MesaResolvida, status: string): Promise<void> {
  await prisma.mesa.updateMany({
    // `updateMany` com empresaId no where: mesmo que o mesaId estivesse
    // errado, nunca alcançaria a mesa de outra empresa.
    where: { id: mesa.mesaId, empresaId: mesa.empresaId },
    data: { status, abertaEm: undefined },
  });
  emitirEventoTempoReal(mesa.empresaId, "mesa");
}

/* ------------------------------- Comanda ---------------------------------- */

export interface ResumoComanda {
  pedidoId: string | null;
  numero: number | null;
  total: number;
  aguardandoAprovacao: boolean;
  itens: { nome: string; quantidade: number; tamanho: string | null; total: number }[];
}

/**
 * Comanda aberta da mesa = o Pedido `canal: "salao"` ainda em andamento.
 * Mesma definição que o PDV usa em `/api/mesas/[id]/itens`.
 */
export async function getComandaDaMesa(mesa: MesaResolvida): Promise<ResumoComanda> {
  const pedido = await prisma.pedido.findFirst({
    where: {
      empresaId: mesa.empresaId,
      mesaId: mesa.mesaId,
      canal: "salao",
      status: { in: ["andamento", "pendente", "pronto"] },
    },
    orderBy: { criadoEm: "desc" },
    include: { itens: true },
  });
  if (!pedido) {
    return { pedidoId: null, numero: null, total: 0, aguardandoAprovacao: false, itens: [] };
  }
  return {
    pedidoId: pedido.id,
    numero: pedido.numero,
    total: pedido.total,
    aguardandoAprovacao: pedido.producao === "aguardando_aprovacao",
    itens: pedido.itens.map((i: { nome: string; quantidade: number; tamanho: string | null; precoUnit: number }) => ({
      nome: i.nome,
      quantidade: i.quantidade,
      tamanho: i.tamanho,
      total: i.precoUnit * i.quantidade,
    })),
  };
}
