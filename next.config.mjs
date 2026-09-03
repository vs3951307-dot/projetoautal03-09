/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // CORREÇÃO DE AUDITORIA (bug confirmado): o projeto tem um
  // `instrumentation.ts` na raiz que faz a CONFERÊNCIA DE VARIÁVEIS
  // OBRIGATÓRIAS na subida do processo (DATABASE_URL, SECRETS_MASTER_KEY,
  // EMERGENCIA_TOKEN) e avisa sobre deploy em modo cluster.
  //
  // No Next.js 14 esse arquivo SÓ é compilado e executado com a flag
  // abaixo ligada (ela só virou padrão no Next 15). Sem ela o arquivo era
  // simplesmente ignorado — verificado no build: `.next/server/` não
  // continha `instrumentation.js` e `required-server-files.json` trazia
  // `instrumentationHook: false`.
  //
  // Ou seja: toda a proteção "falhe no deploy, não no meio de um pedido"
  // era código morto. Subir sem `SECRETS_MASTER_KEY` era silencioso, e o
  // erro só apareceria na primeira mensagem de WhatsApp ou nota fiscal.
  experimental: {
    instrumentationHook: true,
  },
  // Preparado para PWA: cabeçalhos de cache para o manifest e ícones.
  // Para um PWA completo, adicione `next-pwa` (ou Workbox manual) apontando
  // para public/manifest.json e um service worker em public/sw.js.
  async headers() {
    return [
      {
        source: '/manifest.json',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }],
      },
      // PEDIDO 20 (segurança): headers de proteção aplicados a todas as
      // respostas. `frame-ancestors 'none'` bloqueia clickjacking; a app
      // não é embutível em iframes. `X-Frame-Options` mantém compatibilidade
      // com navegadores antigos.
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
          // HSTS (força HTTPS) — o Render já serve por TLS; este header
          // impede downgrade para HTTP em navegadores modernos.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          // Permissions-Policy restringe APIs sensíveis do navegador.
          // `camera=(self)` mantém o scanner de QR do entregador
          // (/entregador/scanear usa html5-qrcode → getUserMedia).
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), serial=(), magnetometer=(), gyroscope=(), accelerometer=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
