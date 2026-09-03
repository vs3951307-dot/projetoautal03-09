import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { contaBloqueada, registrarFalhaLockout, resetarLockout } from "@/lib/rate-limit";

/**
 * Regressão do bug encontrado na auditoria.
 *
 * O QUE ESTAVA ERRADO: `/api/auth/login` chamava `registrarFalhaLockout()`
 * ANTES de conferir a senha. Com isso toda tentativa era contada como
 * falha — inclusive as bem sucedidas. Quem errasse a senha 9 vezes e
 * acertasse na 10ª era bloqueado por 15 minutos SEM a rota nem chegar a
 * conferir a senha correta.
 *
 * Estes testes provam o contrato que a correção estabeleceu:
 *   - `contaBloqueada()` é LEITURA PURA (não consome tentativa);
 *   - só `registrarFalhaLockout()` conta;
 *   - o acerto na última tentativa disponível passa.
 *
 * Não precisam de banco — são lógica pura de memória.
 */
describe("lockout de conta no login", () => {
  const chave = "conta:teste-lockout@exemplo.com";

  beforeEach(() => {
    resetarLockout(chave);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetarLockout(chave);
  });

  it("contaBloqueada() não consome tentativa, por mais que seja chamada", () => {
    for (let i = 0; i < 50; i++) {
      expect(contaBloqueada(chave).bloqueado).toBe(false);
    }
    // Depois de 50 consultas, ainda devem restar as 10 falhas inteiras.
    for (let i = 0; i < 9; i++) {
      registrarFalhaLockout({ chave, maxFalhas: 10, bloqueioMs: 15 * 60_000 });
    }
    expect(contaBloqueada(chave).bloqueado).toBe(false);
  });

  it("REGRESSÃO: acerto na 10ª tentativa (após 9 erros) NÃO é bloqueado", () => {
    // 9 senhas erradas — é o que o usuário faz antes de lembrar a senha.
    for (let i = 0; i < 9; i++) {
      const r = registrarFalhaLockout({ chave, maxFalhas: 10, bloqueioMs: 15 * 60_000 });
      expect(r.bloqueado).toBe(false);
    }

    // 10ª tentativa: a senha está CERTA. O fluxo correto consulta o
    // bloqueio primeiro e NÃO registra falha. Antes da correção, a rota
    // registrava a falha aqui, batia em maxFalhas e devolvia 423.
    expect(contaBloqueada(chave).bloqueado).toBe(false);

    // Login bem sucedido zera o contador.
    resetarLockout(chave);
    expect(contaBloqueada(chave).bloqueado).toBe(false);
  });

  it("10 senhas ERRADAS bloqueiam de verdade (a proteção continua existindo)", () => {
    let ultimo = { bloqueado: false, restanteMs: 0 };
    for (let i = 0; i < 10; i++) {
      ultimo = registrarFalhaLockout({ chave, maxFalhas: 10, bloqueioMs: 15 * 60_000 });
    }
    expect(ultimo.bloqueado).toBe(true);
    expect(contaBloqueada(chave).bloqueado).toBe(true);
    expect(contaBloqueada(chave).restanteMs).toBeGreaterThan(0);
  });

  it("o bloqueio expira depois da janela", () => {
    for (let i = 0; i < 10; i++) {
      registrarFalhaLockout({ chave, maxFalhas: 10, bloqueioMs: 15 * 60_000 });
    }
    expect(contaBloqueada(chave).bloqueado).toBe(true);

    vi.advanceTimersByTime(15 * 60_000 + 1_000);
    expect(contaBloqueada(chave).bloqueado).toBe(false);
  });
});
