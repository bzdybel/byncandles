/** Wspólne ustawienia obrazów - jedno miejsce dla formatów i rozmiarów pochodnych. */
import type { ImageOutputFormat } from 'astro';

/** Wszystkie zdjęcia na stronie w WebP: szybkie kodowanie (także w `astro dev`) i obsługa we wszystkich przeglądarkach. */
export const FORMATS: ImageOutputFormat[] = ['webp'];
/** Format <img> w <picture> (zapasowy) - też WebP, żeby nie generować i nie serwować JPG. */
export const FALLBACK: ImageOutputFormat = 'webp';
/** Miniatura w koszyku (72×90 px w 2x). */
export const THUMB = { width: 144, format: 'webp', quality: 70 } as const;
/** Obraz dla Open Graph i Google - jedyny JPEG: podglądy linków (Messenger, WhatsApp, Facebook) nie zawsze czytają WebP. Nie trafia do odwiedzających. */
export const SHARE = { width: 1200, format: 'jpeg', quality: 80 } as const;
