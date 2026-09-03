-- Cardápio digital por mesa: token público revogável.
--
-- Migration ADITIVA: cria uma tabela nova e não altera nenhuma coluna,
-- índice ou constraint existente. Nenhum módulo atual (PDV, comandas,
-- estoque, cozinha, impressão, autenticação) lê ou escreve nesta tabela.
-- Rollback em `rollback.sql`: um único DROP TABLE.

CREATE TABLE "MesaTokenAcesso" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "mesaId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revogadoEm" TIMESTAMP(3),
    "criadoPor" TEXT,

    CONSTRAINT "MesaTokenAcesso_pkey" PRIMARY KEY ("id")
);

-- Unicidade POR EMPRESA: um token da empresa A nunca colide com o da B.
CREATE UNIQUE INDEX "MesaTokenAcesso_empresaId_token_key"
    ON "MesaTokenAcesso"("empresaId", "token");

CREATE INDEX "MesaTokenAcesso_mesaId_idx" ON "MesaTokenAcesso"("mesaId");
CREATE INDEX "MesaTokenAcesso_empresaId_ativo_idx" ON "MesaTokenAcesso"("empresaId", "ativo");

ALTER TABLE "MesaTokenAcesso"
    ADD CONSTRAINT "MesaTokenAcesso_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MesaTokenAcesso"
    ADD CONSTRAINT "MesaTokenAcesso_mesaId_fkey"
    FOREIGN KEY ("mesaId") REFERENCES "Mesa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
