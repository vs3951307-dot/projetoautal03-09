import { Client } from "pg";
async function main() {
  const c = new Client(process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "");
  await c.connect();
  const r = await c.query(`select p.nome, p.id from tenant_disk_pizza_rozeno."Produto" p order by p.nome`);
  for (const p of r.rows) {
    const tam = await c.query(
      `select t.nome, pt.valor, t."maxSabores" from tenant_disk_pizza_rozeno."PrecoTamanho" pt
        join tenant_disk_pizza_rozeno."Tamanho" t on t.id = pt."tamanhoId"
       where pt."produtoId" = $1 order by t."fatorPreco"`, [p.id]
    );
    const sab = await c.query(
      `select s.nome, s.tipo from tenant_disk_pizza_rozeno."ProdutoSabor" ps
        join tenant_disk_pizza_rozeno."Sabor" s on s.id = ps."saborId"
       where ps."produtoId" = $1 order by s.nome`, [p.id]
    );
    console.log(`\n[${p.nome}]`);
    console.log("  tamanhos:", tam.rows.map((t) => `${t.nome}=R$${t.valor}(max${t.maxSabores})`).join(" | ") || "(n/a)");
    console.log("  sabores:", sab.rows.map((s) => `${s.nome}(${s.tipo})`).join(" | ") || "(n/a)");
  }
  await c.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
