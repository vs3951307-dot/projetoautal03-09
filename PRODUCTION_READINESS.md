# PRODUCTION_READINESS — PedidoFlow

## Resultado REAL dos comandos (última rodada neste ambiente)

| Comando | Resultado |
|---|---|
| `npm install --registry https://registry.npmjs.org/` | **OK** (600 packages) |
| `npx prisma generate` | **OK** |
| `npx prisma validate` (com DATABASE_URL+DIRECT_URL) | **OK** se env setado; sem env falha P1012 (esperado) |
| `npm run typecheck` (`NODE_OPTIONS=--max-old-space-size=4096`) | **OK** (sem erros) |
| `npm run lint` | **OK** (apenas warnings pré-existentes de img/hooks) |
| `npm run test` (suite completa) | **111 passed**, 52 skipped; **9 files failed** por falta de PostgreSQL (`DATABASE_URL`) |
| Testes unitários isolados (dinheiro, trial, persona, estoque, retirada, precificação, disponibilidade) | **37/37 passed** |
| `npm run test:dom` | Não reexecutado nesta rodada |
| `npm run build` | **SIGKILL / OOM** neste ambiente (heap limitado) |
| PostgreSQL Docker | **Docker não disponível** neste ambiente |
| `apt install postgresql` | Pacotes não disponíveis no apt deste ambiente |

## As 3 pendências tratadas

1. **Monetário** — `src/lib/dinheiro.ts` + uso em `precificacao` e `criar-pedido` (centavos inteiros). Migration Decimal global do schema adiada (não destrutiva).
2. **Testes** — unitários novos verdes; suítes de banco exigem Postgres externo (`docker-compose.test.yml` incluído).
3. **Retirada** — guard explícito `exigeEntrega = canal === "delivery"`; testes de canal; `api-erro` sem vazamento.

## Bloqueios de operação

`empresaPodeOperarSistema` cobre trial vencido, bloqueada, excluída, assinatura vencida — WhatsApp + fila impressão.

## Como fechar 100% no seu servidor

```bash
docker compose -f docker-compose.test.yml up -d
export DATABASE_URL=postgresql://pedidoflow:pedidoflow_test@127.0.0.1:5433/pedidoflow_test?schema=public
export DIRECT_URL=$DATABASE_URL
npm ci
npx prisma generate
npx prisma validate
npx prisma migrate deploy
npm run typecheck
npm run lint
npm run test
npm run test:dom
NODE_OPTIONS=--max-old-space-size=4096 npm run build
```
