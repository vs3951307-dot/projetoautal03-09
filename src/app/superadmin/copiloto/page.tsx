import { exigirSuperAdmin } from "@/lib/super-admin/auth";
import { CopilotoSupremo } from "./_components/copiloto-supremo";

/** Copiloto Supremo — ferramenta OPCIONAL. A administração normal é pelo Super Admin. */
export default async function CopilotoSupremoPage() {
  const superAdmin = await exigirSuperAdmin();
  return <CopilotoSupremo nomeSuperAdmin={superAdmin.nome} />;
}
