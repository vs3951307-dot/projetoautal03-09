const { Client } = require("pg");
const { configDeConexao } = require("./_dbconn.cjs");

async function main() {
  const client = new Client(configDeConexao());

  await client.connect();

  // Check all preco/valor/total columns in all schemas
  const cols = await client.query(
    `SELECT table_schema, table_name, column_name, data_type, numeric_precision, numeric_scale
     FROM information_schema.columns 
     WHERE (column_name LIKE '%preco%' OR column_name LIKE '%valor%' OR column_name LIKE '%total%' OR column_name = 'troco' OR column_name = 'saldoInicial' OR column_name = 'taxaEntrega' OR column_name = 'trocoPara')
     AND table_schema IN ('public', 'tenant_disk_pizza_rozeno')
     ORDER BY table_schema, table_name, column_name`
  );

  console.log("Columns:");
  cols.rows.forEach((r) =>
    console.log(`  ${r.table_schema}.${r.table_name}.${r.column_name}: ${r.data_type}(${r.numeric_precision},${r.numeric_scale})`)
  );

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
