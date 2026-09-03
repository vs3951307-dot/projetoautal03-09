import { describe, it, expect } from "vitest";
import {
  usuarioTemCopiloto,
  temPermissao,
  PAPEIS,
  ROTULOS_PAPEL,
} from "@/lib/permissao";

describe("usuarioTemCopiloto (PEDIDO 5)", () => {
  const comPapel = (papel: string, modulosAtivos: string[] = ["copiloto"]) => ({
    papel,
    modulosAtivos,
  });

  it("mostra o copiloto para Administrador com módulo ativo", () => {
    expect(usuarioTemCopiloto(comPapel("ADMINISTRADOR"), "copiloto")).toBe(true);
  });

  it("mostra o copiloto para Caixa com módulo ativo", () => {
    expect(usuarioTemCopiloto(comPapel("CAIXA"), "copiloto")).toBe(true);
  });

  it("NÃO mostra para Garçom, Cozinha ou Entregador", () => {
    for (const papel of ["GARCOM", "COZINHA", "ENTREGADOR"]) {
      expect(usuarioTemCopiloto(comPapel(papel), "copiloto")).toBe(false);
    }
  });

  it("NÃO mostra quando o módulo copiloto está inativo", () => {
    expect(usuarioTemCopiloto(comPapel("ADMINISTRADOR", []), "copiloto")).toBe(false);
  });

  it("valida consistência: 'admin' segue apenas o papel Administrador", () => {
    for (const papel of PAPEIS) {
      const admin = temPermissao(
        { id: "u1", nome: "U", email: "u@e", papel, ativo: true, permissaos: [] },
        "admin"
      );
      expect(admin).toBe(papel === "ADMINISTRADOR");
    }
  });

  it("tem rótulo humano para cada papel", () => {
    for (const papel of PAPEIS) {
      expect(ROTULOS_PAPEL[papel].length).toBeGreaterThan(0);
    }
  });
});
