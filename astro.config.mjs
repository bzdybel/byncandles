// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { NOINDEX_PATHS, SITE_URL } from './src/lib/site.ts';

// https://astro.build/config
export default defineConfig({
  site: SITE_URL,
  // Cloudflare Pages serwuje /strona/index.html pod /strona/ — trzymamy jeden kanoniczny wariant.
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'auto' },
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  integrations: [
    sitemap({
      filter: (page) => !NOINDEX_PATHS.includes(new URL(page).pathname) && !new URL(page).pathname.startsWith('/admin/'),
    }),
  ],
});
