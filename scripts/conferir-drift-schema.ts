/**
 * Confere se o `schema.prisma` e o banco realmente batem, coluna a coluna,
 * no schema `public` (a plataforma).
 *
 * MOTIVO: `Sabor.fotoUrl` estava declarado no schema.prisma sem nenhuma
 * migration correspondente. Num banco criado do zero com
 * `prisma migrate deploy`, a coluna não existia e o seed morria com
 * P2022. Em produção isso ficou escondido porque
 * `sincronizar-schemas-tenants.ts` conserta os schemas de TENANT — mas
 * não o `public`.
 *
 * Uso: npx tsx scripts/conferir-drift-schema.ts
 * Sai com código 1 se houver divergência.
 */
import { Prisma } from "@prisma/client";
import { Client } from "pg";

const SCHEMA = process.env.SCHEMA_ALVO ?? "public";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada.");
  const client = new Client({ connectionString: url });
  await client.connect();

  const colunas = await client.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns where table_schema = $1`,
    [SCHEMA]
  );
  const porTabela = new Map<string, Set<string>>();
  for (const c of colunas.rows) {
    if (!porTabela.has(c.table_name)) porTabela.set(c.table_name, new Set());
    porTabela.get(c.table_name)!.add(c.column_name);
  }

  const faltando: string[] = [];
  const tabelasFaltando: string[] = [];
  for (const modelo of Prisma.dmmf.datamodel.models) {
    const tabela = modelo.dbName ?? modelo.name;
    const existentes = porTabela.get(tabela);
    if (!existentes) {
      tabelasFaltando.push(tabela);
      continue;
    }
    for (const campo of modelo.fields) {
      // Relações e listas não viram coluna.
      if (campo.kind === "object" || campo.isList) continue;
      const coluna = campo.dbName ?? campo.name;
      if (!existentes.has(coluna)) faltando.push(`${tabela}.${coluna}`);
    }
  }
  await client.end();

  if (tabelasFaltando.length === 0 && faltando.length === 0) {
    console.log(`OK — schema.prisma e o schema "${SCHEMA}" estão alinhados.`);
    return;
  }
  if (tabelasFaltando.length > 0) console.error("Tabelas ausentes:", tabelasFaltando.join(", "));
  if (faltando.length > 0) console.error("Colunas ausentes:", faltando.join(", "));
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
