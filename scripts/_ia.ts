import { Client } from "pg";
import { receberMensagemWhatsApp } from "../src/lib/atendente/motor";
import { ativarTenant } from "../src/lib/tenant-db";
import { tenantALS } from "../src/lib/tenant-context";

const telefone = process.argv[2];
const texto = process.argv.slice(3).join(" ");

async function main() {
  const pg = new Client(process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "");
  await pg.connect();
  const row = await pg.query(`select e.id as "empresaId", e.slug, e."schemaBanco", e."databaseUrlSecreta" from public."Empresa" e where e.slug='disk-pizza-rozeno'`);
  const empresa = row.rows[0];
  const store = { contextoTenant: null as any };
  await tenantALS.run(store, async () => {
    ativarTenant({ id: empresa.empresaId, schemaBanco: empresa.schemaBanco, databaseUrlSecreta: empresa.databaseUrlSecreta, slug: empresa.slug });
    const r = await receberMensagemWhatsApp(empresa.empresaId, telefone, texto, "simulacao");
    console.log(`\n🧑 [${telefone}] ${texto}`);
    console.log(`🤖 [etapa=${r.etapa}|status=${r.status}|humana=${r.humana}|pedidoId=${r.pedidoId ?? "-"}]:\n${r.resposta}`);
  });
  await pg.end();
}
main().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
