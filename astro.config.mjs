// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';
import keystatic from '@keystatic/astro';
import { NOINDEX_PATHS, SITE_URL } from './src/lib/site.ts';

// Panel Keystatic (/keystatic) działa na razie tylko lokalnie (`npm run dev`),
// dzięki czemu produkcja pozostaje w 100% statyczna. Tryb GitHub dla produkcji — osobny etap.
const isDev = process.argv.includes('dev');

// https://astro.build/config
export default defineConfig({
  site: SITE_URL,
  // Cloudflare serwuje /strona/index.html pod /strona/ — trzymamy jeden kanoniczny wariant.
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'auto' },
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  image: { responsiveStyles: false },
  // Fonty pobierane przy buildzie i serwowane z naszej domeny (bez zapytań do Google = RODO + szybkość).
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: 'Bodoni Moda',
      cssVariable: '--font-display',
      weights: ['400'],
      styles: ['normal', 'italic'],
      subsets: ['latin', 'latin-ext'],
      fallbacks: ['Georgia', 'serif'],
    },
    {
      provider: fontProviders.fontsource(),
      name: 'Jost',
      cssVariable: '--font-body',
      weights: ['300', '400', '500'],
      styles: ['normal'],
      subsets: ['latin', 'latin-ext'],
      fallbacks: ['system-ui', 'sans-serif'],
    },
  ],
  integrations: [
    sitemap({
      filter: (page) => !NOINDEX_PATHS.includes(new URL(page).pathname) && !new URL(page).pathname.startsWith('/admin/'),
    }),
    ...(isDev ? [react(), keystatic()] : []),
  ],
});
