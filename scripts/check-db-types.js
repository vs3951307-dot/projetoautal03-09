const { Client } = require("pg");
const { configDeConexao } = require("./_dbconn.cjs");

async function main() {
  const client = new Client(configDeConexao());

  await client.connect();

  // Check current column types in Produto (public schema)
  const publicProduto = await client.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Produto' AND table_schema = 'public' AND column_name = 'preco'"
  );
  console.log("Public Produto.preco:", publicProduto.rows);

  // Check tenant schema
  const tenantProduto = await client.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Produto' AND table_schema = 'tenant_disk_pizza_rozeno' AND column_name = 'preco'"
  );
  console.log("Tenant Produto.preco:", tenantProduto.rows);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
