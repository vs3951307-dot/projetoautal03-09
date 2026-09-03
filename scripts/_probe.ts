import { Client } from "pg";
import { receberMensagemWhatsApp } from "../src/lib/atendente/motor";
import { ativarTenant } from "../src/lib/tenant-db";
import { tenantALS } from "../src/lib/tenant-context";

const FRASES = [
  "pizza grande metade 4 queijos metade calabresa",
  "pizza grande metade calabresa metade 4 queijos",
  "pizza grande metade 4 queijos metade doritos",
  "pizza grande metade doritos metade 4 queijos",
  "uma pizza grande metade 4 queijos e metade doritos",
  "pizza grande metade 4 queijos e doritos",
];

async function probe(empresa: any, frase: string, i: number) {
  const telefone = `1999${String(1000 + i)}1`;
  const store = { contextoTenant: null as any };
  let resp = "";
  await tenantALS.run(store, async () => {
    ativarTenant({ id: empresa.empresaId, schemaBanco: empresa.schemaBanco, databaseUrlSecreta: empresa.databaseUrlSecreta, slug: empresa.slug });
    const r = await receberMensagemWhatsApp(empresa.empresaId, telefone, frase, "simulacao");
    resp = r.resposta.replace(/\n/g, " | ");
  });
  console.log(`\n>>> [${i}] ${frase}\n   ${resp}`);
}

async function main() {
  const pg = new Client(process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "");
  await pg.connect();
  const row = await pg.query(`select e.id as "empresaId", e.slug, e."schemaBanco", e."databaseUrlSecreta" from public."Empresa" e where e.slug='disk-pizza-rozeno'`);
  const empresa = row.rows[0];
  for (let i = 0; i < FRASES.length; i++) await probe(empresa, FRASES[i], i);
  await pg.end();
}
main().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
