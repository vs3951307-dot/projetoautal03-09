-- Rollback: remove a coluna de foto do sabor.
ALTER TABLE "Sabor" DROP COLUMN IF EXISTS "fotoUrl";
