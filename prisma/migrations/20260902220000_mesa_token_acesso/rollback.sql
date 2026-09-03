-- Rollback da migration 20260902220000_mesa_token_acesso.
-- Seguro: nenhuma outra tabela referencia MesaTokenAcesso.
-- Depois de rodar, remova o model MesaTokenAcesso do schema.prisma e as
-- relações `mesaTokensAcesso` (Empresa) e `tokensAcesso` (Mesa).
DROP TABLE IF EXISTS "MesaTokenAcesso";
