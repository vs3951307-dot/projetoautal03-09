import { Client } from "pg";
async function main() {
  const c = new Client(process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "");
  await c.connect();
  const r = await c.query(
    `select column_name, data_type from information_schema.columns
      where table_schema = 'tenant_disk_pizza_rozeno' and table_name = 'Pedido' order by ordinal_position`
  );
  console.log("PEDIDO:", r.rows.map((x) => `${x.column_name}:${x.data_type}`).join(", "));
  const i = await c.query(
    `select column_name from information_schema.columns
      where table_schema = 'tenant_disk_pizza_rozeno' and table_name = 'ItemPedido' order by ordinal_position`
  );
  console.log("ITEM:", i.rows.map((x) => x.column_name).join(", "));
  await c.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
