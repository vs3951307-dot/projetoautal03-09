/**
 * Mensagens padrão humanas para o atendente WhatsApp (multi-nicho).
 */

export const MENSAGENS_ERRO = {
  itemIndisponivel: "No momento esse item está indisponível. Posso te mostrar opções parecidas?",
  enderecoInvalido: "Não consegui validar esse endereço. Pode confirmar o bairro ou o CEP?",
  foraDeArea: "No momento não estamos entregando nessa região. Quer retirar no local?",
  falhaPedido: "Tive um problema ao registrar seu pedido. Quer tentar de novo ou prefere falar com um atendente?",
  falhaTecnica: "Tive uma instabilidade aqui. Pode repetir? Se preferir, te transfiro para um atendente.",
  foraHorario: "No momento estamos fechados. Posso anotar seu pedido para quando abrirmos?",
  foraEscopo: "Essa parte eu não consigo resolver por aqui. Vou te transferir para um atendente.",
  semConfirmacao: 'Para eu finalizar, preciso que você confirme o resumo do pedido (pode responder "sim" ou "confirma").',
  manipulacao: "Sigo as regras e os preços da loja. Posso te ajudar com o cardápio ou com o seu pedido?",
} as const;

export function mensagemBoasVindas(params: {
  nomeAtendente?: string;
  nomeCliente?: string | null;
  loja?: string | null;
  nicho?: string;
}): string {
  const cliente = params.nomeCliente ? `Oi, ${params.nomeCliente}!` : "Oi!";
  const loja = params.loja?.trim() || "nossa loja";
  const nome = params.nomeAtendente?.trim();
  const emoji =
    params.nicho === "pizzaria"
      ? "🍕"
      : params.nicho === "hamburgueria"
        ? "🍔"
        : params.nicho === "farmacia"
          ? "💊"
          : params.nicho === "petshop"
            ? "🐾"
            : params.nicho === "moda"
              ? "👗"
              : "😊";

  if (!nome) return `${cliente} ${emoji} Tudo bem? Como posso te ajudar?`;
  return `${cliente} Eu sou ${nome}, da ${loja} ${emoji} Como posso te ajudar?`;
}
