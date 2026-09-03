import { Client } from "pg";
async function main() {
  const c = new Client(process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "");
  await c.connect();
  for (const t of ["Produto", "ProdutoTamanho", "SaborProduto", "Tamanho", "Sabor"]) {
    const r = await c.query(
      `select column_name from information_schema.columns
        where table_schema='tenant_disk_pizza_rozeno' and table_name=$1 order by ordinal_position`, [t]
    );
    console.log(`${t}:`, r.rows.map((x) => x.column_name).join(", "));
  }
  await c.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
