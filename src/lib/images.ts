/** Zdjęcia z feedu @by_n.candles (prawa autorskie: by N. candles). Opisy alt: `images` w src/i18n/pl.ts. */
import type { ImageMetadata } from 'astro';
import { images as alt } from '../i18n/pl.ts';
import roze from '../assets/site/swiece-sojowe-roze-pudrowe.jpg';
import muszle from '../assets/site/swiece-muszle-sojowe.jpg';
import rozaWrzosowa from '../assets/site/swieca-roza-wrzosowa.jpg';
import krowki from '../assets/site/swiece-krowki-highland.jpg';
import pszczeli from '../assets/site/swiece-wosk-pszczeli-budda-buldog.jpg';
import misie from '../assets/site/swiece-misie-rozowy-bialy.jpg';
import kurka from '../assets/site/swieca-kurka-rozowa.jpg';
import buldog from '../assets/site/swieca-buldog-francuski.jpg';
import wSzkle from '../assets/site/swieca-w-szkle-pomarancza-cynamon.jpg';
import procesKnot from '../assets/site/proces-knot-swiecy.jpg';
import procesZapach from '../assets/site/proces-olejek-zapachowy.jpg';
import procesOdlewanie from '../assets/site/proces-odlewanie-wosku.jpg';
import prezentPudelka from '../assets/site/prezent-rozowe-pudelka-swiece.jpg';
import prezentAlpaka from '../assets/site/prezent-alpaka-zapakowana.jpg';

export interface SiteImage { src: ImageMetadata; alt: string }

const sources = {
  roze, muszle, rozaWrzosowa, krowki, pszczeli, misie, kurka, buldog, wSzkle,
  procesKnot, procesZapach, procesOdlewanie, prezentPudelka, prezentAlpaka,
} satisfies Record<keyof typeof alt, ImageMetadata>;

export const IMG = Object.fromEntries(
  Object.entries(sources).map(([key, src]) => [key, { src, alt: alt[key as keyof typeof alt] }]),
) as Record<keyof typeof sources, SiteImage>;
