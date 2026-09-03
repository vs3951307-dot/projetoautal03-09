/* eslint-disable no-console */
import { prisma } from "@/lib/prisma";
import { ativarTenant } from "@/lib/tenant-db";
async function main() {
  const rozeno = await prisma.empresa.findUnique({ where: { id: "cmtlethkn0004peq8s195e7ye" } });
  if (!rozeno) throw new Error("empresa?");
  ativarTenant(rozeno);
  const prods = await prisma.produto.findMany({
    where: { empresaId: rozeno.id, ativo: true },
    include: { sabores: { include: { sabor: true } }, precos: { include: { tamanho: true } } },
    orderBy: { nome: "asc" },
  });
  const nomes = prods.map((p) => p.nome);
  console.log("PRODUTOS:", nomes.join(" | "));
  const pq = prods.find((p) => /queijos/i.test(p.nome));
  console.log("\n== '4 Queijos' ==");
  console.log("temSabores (sabores.length>0):", (pq?.sabores ?? []).length);
  console.log("sabores:", (pq?.sabores ?? []).map((s) => s.sabor.nome).join(", ") || "(nenhum)");
  console.log("precos:", (pq?.precos ?? []).map((pt) => `${pt.tamanho.nome}=${pt.valor}`).join(" | "));
  const dor = prods.find((p) => /doritos/i.test(p.nome));
  console.log("\n== 'Doritos' ==");
  console.log("sabores:", (dor?.sabores ?? []).map((s) => s.sabor.nome).join(", ") || "(nenhum)");
  console.log("precos:", (dor?.precos ?? []).map((pt) => `${pt.tamanho.nome}=${pt.valor}`).join(" | "));
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });