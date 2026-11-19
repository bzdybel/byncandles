import type { APIRoute } from 'astro';

// Strony z noindex NIE są blokowane w robots.txt — robot musi je pobrać, żeby zobaczyć noindex.
export const GET: APIRoute = ({ site }) =>
  new Response(['User-agent: *', 'Allow: /', '', `Sitemap: ${new URL('sitemap-index.xml', site).href}`, ''].join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
