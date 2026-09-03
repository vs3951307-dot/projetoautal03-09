/**
 * Regra absoluta do nome do cliente.
 *
 * CAUSA RAIZ do bug "Prazer, Pizza Calabresa e Estrogonofe de Carne!":
 * o motor tratava QUALQUER texto sem intenção reconhecida como se fosse
 * o nome do cliente (`motor.ts`, etapa `saudacao`), e o texto que chegava
 * lá já havia sido reescrito pelo LLM com nomes do cardápio.
 *
 * Aqui a política é invertida: o nome só é aceito quando existe
 * EVIDÊNCIA SEMÂNTICA EXPLÍCITA de que a mensagem é uma apresentação.
 * Na dúvida, não grava. Perder o nome custa uma pergunta; gravar o nome
 * errado contamina o pedido, a impressão e o histórico do cliente.
 */

const NORMALIZAR = (t: string) =>
  t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Padrões de apresentação. O nome é o grupo capturado.
 * Só estes formatos gravam nome — não existe caminho "qualquer texto vira nome".
 */
const PADROES: RegExp[] = [
  /\b(?:meu\s+nome\s+(?:e|é|eh)|me\s+chamo|meu\s+nome:)\s+(.{2,40})$/i,
  /\bsou\s+(?:o|a)\s+(.{2,40})$/i,
  /\b(?:pode\s+)?(?:colocar?|coloca|bota|botar|poe|põe|por|anota|anotar|marca|marcar)\s+(?:no\s+)?(?:nome\s+(?:de|do|da)\s+|em\s+nome\s+de\s+)(.{2,40})$/i,
  /\b(?:pode\s+)?(?:colocar?|coloca|anota|anotar)\s+(?:como\s+)?(.{2,40})\s*$/i,
  /\b(?:e|é|eh)\s+(?:o|a)\s+(.{2,40})\s+(?:aqui|falando)$/i,
  /\b(?:aqui\s+(?:e|é|eh)\s+(?:o|a)?)\s*(.{2,40})$/i,
  /\bnome\s*:\s*(.{2,40})$/i,
];

/**
 * Termos que NUNCA podem virar nome, mesmo dentro de um padrão de
 * apresentação ("pode colocar pix" não é um nome).
 */
const PROIBIDOS = [
  "pix", "dinheiro", "cartao", "credito", "debito", "vale", "voucher",
  "entrega", "retirada", "buscar", "delivery", "endereco", "rua", "avenida",
  "av", "bairro", "numero", "cep", "casa", "apto", "apartamento",
  "pizza", "pizzas", "lanche", "lanches", "bebida", "bebidas", "refrigerante",
  "refri", "coca", "guarana", "suco", "cerveja", "agua", "combo", "porcao",
  "grande", "media", "pequena", "familia", "broto", "gigante",
  "sim", "nao", "ok", "obrigado", "obrigada", "valeu", "bom", "boa",
  "cardapio", "menu", "promocao", "total", "conta", "troco",
  "metade", "meia", "meio", "sabor", "sabores", "adicional", "adicionais",
  "cebola", "queijo", "borda", "catupiry", "calabresa", "frango", "carne",
  "estrogonofe", "strogonoff", "strogonofe", "mussarela", "portuguesa",
  "marguerita", "margherita", "bacon", "presunto", "chocolate", "doce",
];

/** Palavras que indicam que a frase é um pedido, não uma apresentação. */
const VERBOS_DE_PEDIDO =
  /\b(quero|queria|gostaria|manda|mandar|vou\s+querer|me\s+ve|traz|pedir|comprar|adiciona|tira|troca|cancela)\b/i;

function ehProibido(candidato: string): boolean {
  const n = NORMALIZAR(candidato);
  const palavras = n.split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return true;
  // Qualquer palavra proibida no candidato invalida o nome inteiro.
  return palavras.some((p) => PROIBIDOS.includes(p));
}

/**
 * Um nome plausível: 1 a 4 palavras, só letras (aceita hífen e
 * apóstrofo), sem dígitos.
 */
function pareceNome(candidato: string): boolean {
  const limpo = candidato.trim().replace(/[.!,;:]+$/, "");
  if (limpo.length < 2 || limpo.length > 40) return false;
  if (/\d/.test(limpo)) return false;
  const palavras = limpo.split(/\s+/).filter(Boolean);
  if (palavras.length === 0 || palavras.length > 4) return false;
  return palavras.every((p) => /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]*$/.test(p));
}

function capitalizar(nome: string): string {
  return nome
    .trim()
    .replace(/[.!,;:]+$/, "")
    .split(/\s+/)
    .map((p) =>
      p.length <= 2 && /^(de|da|do|e)$/i.test(p)
        ? p.toLowerCase()
        : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
    )
    .join(" ");
}

/**
 * Extrai o nome do cliente da mensagem.
 *
 * @param texto Mensagem ORIGINAL do cliente (nunca a versão reescrita
 *              por LLM — o texto reescrito contém nomes do cardápio).
 * @param perguntamosONome `true` quando a última pergunta do sistema foi
 *              exatamente "qual o seu nome?". Só nesse caso uma resposta
 *              seca ("Victor") pode ser aceita como nome.
 * @returns O nome, ou `null` quando não há evidência suficiente.
 */
export function extrairNomeCliente(
  texto: string,
  perguntamosONome = false
): string | null {
  const bruto = texto.trim();
  if (!bruto) return null;

  for (const padrao of PADROES) {
    const m = bruto.match(padrao);
    if (!m) continue;
    const candidato = m[1].trim();
    if (ehProibido(candidato)) return null;
    if (!pareceNome(candidato)) return null;
    return capitalizar(candidato);
  }

  // Resposta seca à pergunta direta "qual o seu nome?".
  if (perguntamosONome) {
    if (VERBOS_DE_PEDIDO.test(bruto)) return null;
    const candidato = bruto.replace(/^(e|é|eh|meu|nome|o|a)\s+/i, "").trim();
    if (ehProibido(candidato)) return null;
    if (!pareceNome(candidato)) return null;
    return capitalizar(candidato);
  }

  return null;
}
