import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { criarSessao } from "@/lib/auth";
import { registrarAuditoria, usuarioSeguro } from "@/lib/acesso";
import {
  verificarLimite,
  ipDaRequisicao,
  contaBloqueada,
  registrarFalhaLockout,
  resetarLockout,
} from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const ip = ipDaRequisicao(req);
  const limite = verificarLimite({ chave: `login:${ip}`, maximo: 5, janelaMs: 60_000 });
  if (!limite.permitido) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Tente novamente em instantes." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limite.reiniciaEm / 1000)) } }
    );
  }
  const corpo = await req.json().catch(() => ({}));
  const email = String(corpo.email ?? "").trim().toLowerCase();
  const senha = String(corpo.senha ?? "");
  const userAgent = req.headers.get("user-agent") ?? undefined;

  if (!email || !senha) {
    return NextResponse.json({ erro: "Informe e-mail e senha." }, { status: 400 });
  }

  // Lockout por conta: 10 falhas CONSECUTIVAS → bloqueio de 15 min.
  //
  // CORREÇÃO DE AUDITORIA (bug real, alcançável no uso normal):
  // aqui era chamado `registrarFalhaLockout()` ANTES de conferir a senha,
  // ou seja, TODA tentativa era contada como falha — inclusive as bem
  // sucedidas. Consequência: quem errava a senha 9 vezes e acertava na
  // 10ª recebia 423 e ficava 15 minutos fora, MESMO tendo digitado a
  // senha correta (a rota nem chegava a conferir a senha). Num terminal
  // de PDV compartilhado entre garçom/caixa isso acontece com facilidade.
  //
  // Agora: consulta o bloqueio sem contar tentativa; a falha só é
  // registrada mais abaixo, quando a senha realmente estiver errada.
  const chaveLockout = `conta:${email}`;
  const lockout = contaBloqueada(chaveLockout);
  if (lockout.bloqueado) {
    return NextResponse.json(
      { erro: "Conta temporariamente bloqueada por muitas tentativas. Tente novamente em instantes." },
      { status: 423, headers: { "Retry-After": String(Math.ceil(lockout.restanteMs / 1000)) } }
    );
  }

  const usuario = await prisma.usuario.findUnique({ where: { email } });
  const senhaOk = usuario ? await bcrypt.compare(senha, usuario.senhaHash) : false;

  if (!usuario || !senhaOk || usuario.ativo === false) {
    // Só AGORA a tentativa conta como falha para o lockout da conta.
    registrarFalhaLockout({ chave: chaveLockout, maxFalhas: 10, bloqueioMs: 15 * 60 * 1000 });
    // Resposta única (não revela se o e-mail existe) + trilha de auditoria.
    await registrarAuditoria("login_falha", `Tentativa com ${email}`, null, ip ?? undefined);
    return NextResponse.json({ erro: "Credenciais inválidas." }, { status: 401 });
  }

  resetarLockout(chaveLockout);

  const token = await criarSessao(usuario.id, userAgent);
  await prisma.usuario.update({
    where: { id: usuario.id },
    data: { ultimoAcesso: new Date() },
  });
  await registrarAuditoria("login", "Login realizado", usuario, ip ?? undefined, usuario.empresaId);

  const resposta = NextResponse.json({
    ok: true,
    usuario: usuarioSeguro(usuario),
  });
  resposta.cookies.set("sessao", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return resposta;
}
