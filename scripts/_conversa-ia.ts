/**
 * Roda uma conversa REAL de IA contra o banco local, chamando a MESMA
 * função que a interface usa (`/api/atendimento/mensagem` →
 * `receberMensagemWhatsApp`). Ativa o tenant como `autorizar()` faz
 * (`ativarTenant` + `tenantALS.run`). Sem mock. Imprime a transcrição e,
 * no fim, consulta o banco real para mostrar o pedido criado.
 */
import { Client } from "pg";
import { receberMensagemWhatsApp } from "../src/lib/atendente/motor";
import { ativarTenant } from "../src/lib/tenant-db";
import { tenantALS } from "../src/lib/tenant-context";

const TELEFONE = "11987654321";

const MENSAGENS: string[] = [
  "Boa noite",
  "Ta fazendo pizza ainda?",
  "Quero uma pizza grande",
  "Meio a meio de 4 Queijos e Doritos",
  "Na verdade troca a de 4 Queijos por Calabresa",
  "Quanto tempo demora pra entregar?",
  "Quero entrega",
  "Meu endereco e Rua das Flores 100, Centro",
  "Quero pagar no pix e meu nome e Joao Silva",
  "Confirmo",
];

async function main() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "";
  const pg = new Client(url);
  await pg.connect();
  try {
    const row = await pg.query(
      `select e.id as "empresaId", e.slug, e."schemaBanco", e."databaseUrlSecreta" from public."Empresa" e where e.slug = 'disk-pizza-rozeno'`
    );
    const empresa = row.rows[0];
    console.log(`Tenant ativo: ${empresa.slug} (schema ${empresa.schemaBanco ?? "auto"})\n`);

    const pedidoIds = new Set<string>();
    const store = { contextoTenant: null as any };
    await tenantALS.run(store, async () => {
      ativarTenant({
        id: empresa.empresaId,
        schemaBanco: empresa.schemaBanco,
        databaseUrlSecreta: empresa.databaseUrlSecreta,
        slug: empresa.slug,
      });

      console.log("=== TRANSCRIÇÃO REAL (motor sem LLM, banco local) ===\n");
      for (const msg of MENSAGENS) {
        const r = await receberMensagemWhatsApp(empresa.empresaId, TELEFONE, msg, "simulacao");
        console.log(`🧑 CLIENTE: ${msg}\n🤖 IA [etapa=${r.etapa} | status=${r.status} | humana=${r.humana}]:\n${r.resposta}\n${"-".repeat(70)}`);
        if (r.pedidoId) pedidoIds.add(r.pedidoId);
      }
    });

    console.log(`\n=== PEDIDO NO BANCO ===  (schema ${empresa.schemaBanco})\n`);
    const pedidos = await pg.query(
      `select p.id, p.numero, p.canal, p.status, p.subtotal, p."taxaEntrega" as taxa, p.total, p."clienteNome", p."clienteTelefone"
         from ${empresa.schemaBanco}."Pedido" p
        where p."clienteTelefone" = $1 order by p."criadoEm"`,
      [TELEFONE]
    );
    console.log(`Pedidos encontrados: ${pedidos.rows.length}`);
    for (const p of pedidos.rows) console.log(JSON.stringify(p));

    if (pedidos.rows.length) {
      const p = pedidos.rows[0];
      const itens = await pg.query(
        `select i.nome, i.quantidade, i."precoUnit", i.tamanho, string_agg(s.nome, ', ') as sabores
           from ${empresa.schemaBanco}."ItemPedido" i
           left join ${empresa.schemaBanco}."ItemPedidoSabor" ips on ips."itemPedidoId" = i.id
           left join ${empresa.schemaBanco}."Sabor" s on s.id = ips."saborId"
          where i."pedidoId" = $1 group by i.id order by i.id`,
        [p.id]
      );
      console.log("\nItens do pedido:");
      for (const it of itens.rows) console.log(JSON.stringify(it));
    }
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error("ERRO:", e); process.exit(1); });
