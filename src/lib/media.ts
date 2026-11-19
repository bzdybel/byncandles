/** Wspólne ustawienia obrazów — jedno miejsce dla formatów i rozmiarów pochodnych. */
import type { ImageOutputFormat } from 'astro';

export const FORMATS: ImageOutputFormat[] = ['avif', 'webp'];
/** Miniatura w koszyku (72×90 px w 2x). */
export const THUMB = { width: 144, format: 'webp', quality: 70 } as const;
/** Obraz dla Open Graph i Google (szeroka kompatybilność). */
export const SHARE = { width: 1200, format: 'jpeg', quality: 80 } as const;
