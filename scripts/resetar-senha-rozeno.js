const bcrypt = require("bcryptjs");
const { Client } = require("pg");
const { configDeConexao } = require("./_dbconn.cjs");

async function main() {
  const client = new Client(configDeConexao());

  await client.connect();

  const novaSenha = process.argv[2];
  if (!novaSenha) {
    console.error("Uso: node scripts/resetar-senha-rozeno.js <NOVA_SENHA>");
    process.exit(1);
  }

  const hash = bcrypt.hashSync(novaSenha, 12);

  const result = await client.query(
    'UPDATE "Usuario" SET "senhaHash" = $1 WHERE "email" LIKE $2',
    [hash, "%@rozeno.com.br"]
  );

  console.log("Linhas atualizadas:", result.rowCount);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
