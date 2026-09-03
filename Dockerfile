# PedidoFlow — imagem de produção
#
# AUDITORIA — o que mudou nesta versão (mudança MÍNIMA, de propósito):
#   1) `npm ci --omit=dev=false` era sintaxe INVÁLIDA. A flag `--omit` só
#      aceita `dev`, `optional` ou `peer`; "dev=false" não é um valor
#      reconhecido, e o build só funcionava porque o npm ignorava o valor
#      inválido em silêncio. A intenção era "instale TAMBÉM as
#      devDependencies" (o build precisa de typescript, tailwind, prisma) —
#      que já é o comportamento padrão de `npm ci`. Agora está correto e
#      não depende de um acidente.
#   2) Adicionado HEALTHCHECK apontando para /api/saude (mesma rota usada
#      pelo orquestrador), agora que essa rota não devolve mais 429.
#
# DECISÃO CONSCIENTE: o estágio final continua copiando o `node_modules`
# inteiro do builder. Isso deixa a imagem maior do que o ideal (leva
# devDependencies), MAS é o que mantém `npm run deploy:migrar` funcionando
# dentro do container — esse script roda `tsx scripts/*.ts`, e `tsx` é uma
# devDependency. Enxugar a imagem exigiria mudar o fluxo de migração, o que
# está fora do escopo desta auditoria. Ver DEPLOY.md (§ imagem enxuta).
#
# O build precisa de rede apenas para o registry do npm e para os engines
# do Prisma. A dependência de fontes do Google EM TEMPO DE BUILD foi
# removida na auditoria (ver src/app/_components/landing/index.tsx).

FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Sem `--omit`: instala dependências de produção E de desenvolvimento,
# que é exatamente o que o estágio de build precisa.
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN npx prisma generate
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
RUN groupadd -r pedidoflow && useradd -r -g pedidoflow pedidoflow
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/next.config.mjs ./
COPY --from=builder /app/scripts ./scripts
USER pedidoflow
EXPOSE 3000

# Mesma rota do orquestrador: 200 com banco acessível, 503 quando não,
# e nunca 429 (ver src/app/api/saude/route.ts).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/saude || exit 1

CMD ["npm", "run", "start"]
