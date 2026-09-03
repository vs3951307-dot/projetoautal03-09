/**
 * ATENÇÃO — ESTE ARQUIVO NÃO É EXECUTADO. O código real está em
 * `src/instrumentation.ts`.
 *
 * DESCOBERTA DA AUDITORIA (segunda parte do mesmo bug):
 * ligar `experimental.instrumentationHook` no next.config.mjs não bastou.
 * O Next.js procura o arquivo de instrumentação na RAIZ do projeto **ou**
 * dentro de `src/` — e quando o projeto usa diretório `src/` (este usa:
 * `src/app`), é só `src/instrumentation.ts` que ele carrega. Com o arquivo
 * na raiz, o build continuava sem emitir `.next/server/instrumentation.js`
 * (verificado com `find .next -iname "*instrumentation*"`, que não
 * devolvia nada) e a conferência de variáveis obrigatórias seguia sendo
 * código morto, mesmo com a flag ligada.
 *
 * Este arquivo foi mantido apenas como sinalização para quem procurar a
 * instrumentação na raiz por hábito. Pode ser apagado sem efeito nenhum.
 */
export {};
