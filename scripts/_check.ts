import { Client } from "pg";
async function main() {
  const c = new Client(process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "");
  await c.connect();
  const r = await c.query(
    `select nome, ativo from tenant_disk_pizza_rozeno."Sabor"
      where nome ilike '%oritos%' or nome ilike '%queijos%' or nome ilike '%calabresa%'`
  );
  console.log("SABORES:", JSON.stringify(r.rows));
  const p = await c.query(`select nome, ativo from tenant_disk_pizza_rozeno."Produto" where nome ilike '%oritos%' or nome ilike '%queijos%'`);
  console.log("PRODUTOS:", JSON.stringify(p.rows));
  const b = await c.query(
    `select * from tenant_disk_pizza_rozeno."Configuracao" where chave ilike '%bloqueio%' or chave ilike '%fico%'`
  ).catch((e) => { console.log("sem Configuracao/bloqueio:", e.message); return { rows: [] }; });
  console.log("CONF:", JSON.stringify(b.rows));
  await c.end();
}
main().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
