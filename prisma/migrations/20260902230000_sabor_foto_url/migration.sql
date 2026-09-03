-- DRIFT CORRIGIDO: `Sabor.fotoUrl` estava declarado no schema.prisma desde
-- a migration de fotos, mas nenhuma migration criava a coluna.
--
-- Consequência real: um banco criado do zero com `prisma migrate deploy`
-- ficava incompatível com o Prisma Client — `prisma db seed` morria com
-- P2022 (`Sabor.fotoUrl` não existe). Em produção o problema ficou
-- escondido porque `scripts/sincronizar-schemas-tenants.ts` conserta os
-- schemas de TENANT em cada deploy, mas nunca o schema `public`.
--
-- `IF NOT EXISTS` porque bancos existentes já podem ter a coluna criada
-- pelo script de sincronização: a migration precisa ser segura nos dois
-- cenários.

ALTER TABLE "Sabor" ADD COLUMN IF NOT EXISTS "fotoUrl" TEXT;
