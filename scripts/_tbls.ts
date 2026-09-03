import { Client } from "pg";
async function main() {
  const c = new Client(process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "");
  await c.connect();
  const r = await c.query(
    `select tablename from pg_tables where schemaname='tenant_disk_pizza_rozeno' order by tablename`
  );
  console.log(r.rows.map((x) => x.tablename).join(", "));
  await c.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
