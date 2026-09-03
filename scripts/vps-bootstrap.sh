#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "Crie o arquivo .env a partir de .env.example antes de continuar."
  exit 1
fi

echo "==> Subindo Postgres..."
docker compose up -d db

echo "==> Aguardando Postgres..."
for i in {1..30}; do
  if docker compose exec -T db pg_isready -U "${POSTGRES_USER:-pedidoflow}" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "==> Migrations..."
docker compose run --rm app npx prisma migrate deploy

echo "==> Build/start app..."
docker compose up -d --build app

echo "OK. App em http://localhost:${APP_PORT:-3000}"
