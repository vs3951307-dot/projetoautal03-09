import type * as React from "react";
import { prisma } from "@/lib/prisma";
import { parseModulos } from "@/lib/modulos";
import { parseLandingConteudo, LANDING_PADRAO, type LandingConteudo } from "@/lib/landing-config";
import { Navbar } from "./navbar";
import {
  Beneficios,
  ComoFunciona,
  Depoimentos,
  Dispositivos,
  Hero,
  Recursos,
} from "./secoes";
import { CtaFinal, Planos, Rodape, type PlanoPublico } from "./planos";

/**
 * Tipografia própria da página comercial: Sora para títulos, Manrope para
 * texto. O produto continua em Geist — as variáveis abaixo só são aplicadas
 * dentro de `.pf-landing`, então nenhuma tela interna muda de fonte.
 *
 * POR QUE NÃO `next/font/google` (AUDITORIA — build offline):
 * `next/font/google` baixa os arquivos da fonte EM TEMPO DE BUILD. Numa
 * máquina de build sem saída para `fonts.googleapis.com` /
 * `fonts.gstatic.com` (Docker em rede restrita, CI isolado, VPS atrás de
 * firewall) o `next build` FALHA — e derruba o deploy inteiro por causa
 * da tipografia de uma única página. `src/app/layout.tsx` já evitava isso
 * usando Geist local; a landing era a única exceção.
 *
 * Agora a fonte é carregada pelo NAVEGADOR, em tempo de execução, e a
 * cadeia de fallback (`Sora` → Geist → system-ui) garante que a página
 * renderize normalmente mesmo se o Google estiver inacessível: muda a
 * fonte, nunca quebra o build nem a página.
 *
 * PARA AUTO-HOSPEDAR (recomendado em produção, elimina a chamada a
 * terceiros e o FOUT): baixe os `.woff2` de Sora (600/700) e Manrope
 * (400/500/600/700), coloque em `public/fontes/` e troque
 * `LINKS_FONTES_LANDING` abaixo por um `<link rel="stylesheet"
 * href="/fontes/landing.css" />` com os `@font-face` apontando para os
 * arquivos locais. Nada mais no código precisa mudar.
 */
const URL_FONTES_LANDING =
  "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Sora:wght@600;700&display=swap";

/** Pilha de fontes aplicada só dentro de `.pf-landing`. */
const FONTE_DISPLAY = '"Sora", var(--font-geist-sans), system-ui, sans-serif';
const FONTE_TEXTO = '"Manrope", var(--font-geist-sans), system-ui, sans-serif';

/**
 * Lê direto do Prisma em vez de chamar a própria `/api/landing-config`: isto
 * roda no servidor, então um fetch HTTP para si mesmo só acrescentaria uma
 * viagem de rede. A rota da API continua existindo para consumidores externos.
 *
 * Banco indisponível não derruba a página comercial — cai no conteúdo padrão
 * e na seção de planos "fale com a gente".
 */
async function carregarDados(): Promise<{ conteudo: LandingConteudo; planos: PlanoPublico[] }> {
  try {
    const [registro, planos] = await Promise.all([
      prisma.landingConfig.findUnique({ where: { id: "landing" } }),
      prisma.plano.findMany({ where: { ativo: true }, orderBy: { ordem: "asc" } }),
    ]);

    return {
      conteudo: registro ? parseLandingConteudo(registro.conteudo) : LANDING_PADRAO,
      planos: planos.map((p) => ({
        nome: p.nome,
        preco: p.preco,
        moeda: p.moeda,
        descricao: p.descricao,
        modulos: parseModulos(p.modulosPadrao),
        iaIncluida: p.iaIncluida,
      })),
    };
  } catch (erro) {
    console.error("[landing] falha ao carregar conteúdo/planos:", erro);
    return { conteudo: LANDING_PADRAO, planos: [] };
  }
}

/**
 * O painel do Super Admin aceita a cor da marca em hex; os tokens da landing
 * são triplas HSL (convenção do tailwind.config). Sem esta conversão o campo
 * "Cor primária" seria um botão que não faz nada.
 */
function hexParaHsl(hex: string | null): string | null {
  if (!hex) return null;
  const limpo = hex.trim().replace(/^#/, "");
  const completo =
    limpo.length === 3 ? limpo.split("").map((c) => c + c).join("") : limpo;
  if (!/^[0-9a-fA-F]{6}$/.test(completo)) return null;

  const r = parseInt(completo.slice(0, 2), 16) / 255;
  const g = parseInt(completo.slice(2, 4), 16) / 255;
  const b = parseInt(completo.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export async function LandingPage() {
  const { conteudo, planos } = await carregarDados();
  const brandCustomizado = hexParaHsl(conteudo.marca.corPrimaria);

  return (
    <main
      className="pf-landing min-h-screen overflow-x-hidden"
      style={
        {
          "--pf-font-display": FONTE_DISPLAY,
          "--pf-font-sans": FONTE_TEXTO,
          ...(brandCustomizado ? { "--pf-brand": brandCustomizado, "--ring": brandCustomizado } : {}),
        } as React.CSSProperties
      }
    >
      {/* Carregamento da tipografia em RUNTIME (ver comentário acima) —
          o Next.js iça estes <link> para o <head>. Se a rede do visitante
          não alcançar o Google, a página cai em Geist e continua íntegra. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={URL_FONTES_LANDING} />
      <Navbar conteudo={conteudo} />
      <Hero conteudo={conteudo} />
      <Recursos conteudo={conteudo} />
      <ComoFunciona conteudo={conteudo} />
      <Dispositivos conteudo={conteudo} />
      <Beneficios conteudo={conteudo} />
      <Depoimentos conteudo={conteudo} />
      <Planos conteudo={conteudo} planos={planos} />
      <CtaFinal conteudo={conteudo} />
      <Rodape conteudo={conteudo} />
    </main>
  );
}
