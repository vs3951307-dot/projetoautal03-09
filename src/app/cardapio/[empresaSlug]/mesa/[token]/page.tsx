import { notFound } from "next/navigation";
import { resolverTokenMesa } from "@/lib/cardapio/tokens";
import { cardapioHabilitado } from "@/lib/cardapio/adapters";
import { MenuClient } from "@/components/cardapio/menu-client";

/**
 * /cardapio/[empresaSlug]/mesa/[token]
 *
 * Página PÚBLICA: sem sessão, sem cookie, sem `autorizar()`. O acesso é o
 * token do QR Code, resolvido no servidor. Se o token foi revogado (QR
 * regenerado), cai em 404 — o link antigo simplesmente não abre mais.
 *
 * Fica fora de `(app)`/admin de propósito: não herda sidebar, header nem
 * qualquer layout autenticado do PedidoFlow.
 */
export const dynamic = "force-dynamic";

export default async function CardapioDaMesa({
  params,
}: {
  params: { empresaSlug: string; token: string };
}) {
  const mesa = await resolverTokenMesa(params.empresaSlug, params.token);
  if (!mesa) notFound();
  if (!(await cardapioHabilitado(mesa.empresaId))) notFound();

  return (
    <MenuClient
      slug={mesa.empresaSlug}
      token={params.token}
      empresaNome={mesa.empresaNome}
      mesaNumero={mesa.mesaNumero}
    />
  );
}
