/**
 * Conferência da taxa de entrega (SOMENTE LEITURA, não grava nada).
 *
 * Lê a config "taxas" do banco (regra `taxaEntrega`) e recalcula a taxa
 * usando a MESMA função `calcularTaxaEntrega` que o servidor usa no
 * fechamento do pedido de delivery. Imprime os cenários pedidos pelo dono
 * (distância fixa, bairro recusado, endereço duvidoso → humano) para
 * conferir se a regra configurada bate com o esperado.
 *
 * Uso:
 *   npm run db:conferir-taxas
 *   npm run db:conferir-taxas -- --schema tenant_disk_pizza_rozeno
 */
import { Client } from "pg";
import { calcularTaxaEntrega, normalizarConfigTaxaEntrega } from "../src/lib/delivery";

function conexaoString(): string {
  return process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "";
}

const CENARIOS: Array<{ nome: string; bairro: string | null; subtotal: number; km?: number }> = [
  { nome: "6 km", bairro: "Centro", subtotal: 50, km: 6 },
  { nome: "10 km", bairro: "Centro", subtotal: 50, km: 10 },
  { nome: "13 km", bairro: "Centro", subtotal: 50, km: 13 },
  { nome: "16 km", bairro: "Centro", subtotal: 50, km: 16 },
  { nome: "Jateí (bairro sem entrega)", bairro: "Jateí", subtotal: 50 },
  { nome: "Endereço rural duvidoso (sem km confiável)", bairro: "Zona Rural", subtotal: 50 },
];

async function main() {
  const args = process.argv.slice(2);
  const schema = args.find((a) => a.startsWith("--schema="))?.split("=")[1] ?? "tenant_disk_pizza_rozeno";

  const client = new Client(conexaoString());
  await client.connect();
  try {
    const row = await client.query(
      `select valor from ${schema}."Configuracao" where chave = 'taxas'`
    );
    let config;
    if (row.rows.length) {
      const raw = JSON.parse(row.rows[0].valor);
      config = normalizarConfigTaxaEntrega(raw.taxaEntrega);
    } else {
      config = null;
    }

    console.log(`Conferência de taxa de entrega — schema ${schema}\n`);
    if (!config) {
      console.log("⚠ Configuração 'taxas' AUSENTE no banco — não é possível conferir.\n");
      return;
    }
    console.log(
      `Regra configurada: ${config.regra} | taxaBase=${config.taxaBase} | valorPorKm=${config.valorPorKm} | taxaMinima=${config.taxaMinima} | raioMaximoKm=${config.raioMaximoKm}`
    );
    console.log(`Bairros sem entrega: ${config.bairrosNaoAtendidos.length ? config.bairrosNaoAtendidos.join(", ") : "(nenhum)"}\n`);

    console.log("CENÁRIO | TAXA | ATENDE | MOTIVO | HUMANO");
    console.log("-".repeat(80));
    for (const c of CENARIOS) {
      const r = calcularTaxaEntrega(config, c.bairro, c.subtotal, { distanciaEmKm: c.km });
      console.log(
        `${c.nome} | R$ ${r.taxa.toFixed(2)} | ${r.atende ? "sim" : "NÃO"} | ${r.motivo ?? "-"} | ${r.exigeHumano ? "ATENDENTE" : "-"}`
      );
    }
    console.log("-".repeat(80));
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("Falha na conferência:", e);
  process.exit(1);
});
