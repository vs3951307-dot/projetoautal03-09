const { Client } = require("pg");
const { configDeConexao } = require("./_dbconn.cjs");

async function main() {
  const client = new Client(configDeConexao());

  await client.connect();

  const result = await client.query(
    'SELECT id, email, nome, papel FROM "Usuario" WHERE "email" LIKE $1 ORDER BY "email"',
    ["%@rozeno.com.br"]
  );

  console.log("Usuarios encontrados:", result.rowCount);
  result.rows.forEach((r) => console.log(`  ${r.email} (${r.papel}) - ${r.nome}`));

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
