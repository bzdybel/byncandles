// @ts-check
import { defineConfig } from 'astro/config';
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
  // Cloudflare Pages serwuje /strona/index.html pod /strona/ — trzymamy jeden kanoniczny wariant.
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'auto' },
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  image: { responsiveStyles: false },
  integrations: [
    sitemap({
      filter: (page) => !NOINDEX_PATHS.includes(new URL(page).pathname) && !new URL(page).pathname.startsWith('/admin/'),
    }),
    ...(isDev ? [react(), keystatic()] : []),
  ],
});
