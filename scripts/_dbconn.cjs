// Carrega credenciais do banco a partir do ambiente (nunca hardcoded).
// Preferência: process.env.DIRECT_URL (conexão direta, sem pooler — usada
// pelas operações DDL/migração). Fallback: DATABASE_URL. Se nenhuma estiver
// definida, tenta ler o arquivo .env local (scripts de operação rodam de
// dentro do projeto, onde o .env existe). Se mesmo assim não houver URL,
// falha com mensagem clara — nunca inventa credencial.

const fs = require("fs");
const path = require("path");

function carregarEnvLocal() {
  try {
    const arquivo = path.join(process.cwd(), ".env");
    const conteudo = fs.readFileSync(arquivo, "utf8");
    for (const linha of conteudo.split(/\r?\n/)) {
      const m = linha.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
      if (m && !Object.prototype.hasOwnProperty.call(process.env, m[1])) {
        process.env[m[1]] = m[2];
      }
    }
  } catch {
    // Sem arquivo .env local — segue com o que estiver em process.env.
  }
}

carregarEnvLocal();

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!url) {
  console.error(
    "Credencial ausente: defina DIRECT_URL (ou DATABASE_URL). " +
      "Nunca commitamos senhas — rode: $env:DIRECT_URL='postgresql://...' antes do script."
  );
  process.exit(1);
}

function configDeConexao() {
  // Aceita tanto uma connectionString única quanto campos separados.
  return { connectionString: url };
}

module.exports = { configDeConexao, url };
