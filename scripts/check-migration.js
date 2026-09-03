const { Client } = require("pg");
const { configDeConexao } = require("./_dbconn.cjs");

async function main() {
  const client = new Client(configDeConexao());

  await client.connect();

  // Check current state
  const check = await client.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Produto' AND column_name = 'preco'"
  );
  console.log("Produto.preco:", check.rows);

  // Check migration record
  const migration = await client.query(
    "SELECT * FROM _prisma_migrations WHERE migration_name = '20260808000000_monetario_float_to_decimal'"
  );
  console.log("Migration:", migration.rows);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
