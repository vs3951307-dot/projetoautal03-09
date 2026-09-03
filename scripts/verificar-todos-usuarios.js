const { Client } = require("pg");
const { configDeConexao } = require("./_dbconn.cjs");

async function main() {
  const client = new Client(configDeConexao());

  await client.connect();

  // Check all users
  const result = await client.query(
    'SELECT id, email, nome, papel FROM "Usuario" ORDER BY "email"'
  );

  console.log("Total de usuarios:", result.rowCount);
  result.rows.forEach((r) => console.log(`  ${r.email} (${r.papel}) - ${r.nome}`));

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
