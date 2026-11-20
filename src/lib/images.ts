/** Zdjęcia z feedu @by_n.candles (prawa autorskie: by N. candles). Opisy alt: `images` w src/i18n/pl.ts. */
import type { ImageMetadata } from 'astro';
import { images as alt } from '../i18n/pl.ts';
import roze from '../assets/site/swiece-sojowe-roze-pudrowe.webp';
import muszle from '../assets/site/swiece-muszle-sojowe.webp';
import rozaWrzosowa from '../assets/site/swieca-roza-wrzosowa.webp';
import krowki from '../assets/site/swiece-krowki-highland.webp';
import pszczeli from '../assets/site/swiece-wosk-pszczeli-budda-buldog.webp';
import misie from '../assets/site/swiece-misie-rozowy-bialy.webp';
import kurka from '../assets/site/swieca-kurka-rozowa.webp';
import buldog from '../assets/site/swieca-buldog-francuski.webp';
import wSzkle from '../assets/site/swieca-w-szkle-pomarancza-cynamon.webp';
import procesKnot from '../assets/site/proces-knot-swiecy.webp';
import procesZapach from '../assets/site/proces-olejek-zapachowy.webp';
import procesOdlewanie from '../assets/site/proces-odlewanie-wosku.webp';
import prezentZielona from '../assets/site/swieca-zielone-szklo-pomarancza-cynamon.webp';
import prezentAlpaka from '../assets/site/prezent-alpaka-zapakowana.webp';
import moai from '../assets/site/swieca-moai.webp';
import czaszka from '../assets/site/swieca-rozowa-czaszka.webp';
import krowaMech from '../assets/site/swieca-krowa-w-mchu.webp';
import dawid from '../assets/site/swieca-dawid-popiersie.webp';
import alpaki from '../assets/site/swiece-alpaki-plot.webp';
import lawenda from '../assets/site/swiece-lawenda-ksiazka.webp';
import buddy from '../assets/site/swiece-buddy-slon.webp';
import cytryna from '../assets/site/swieca-cytryna.webp';

export interface SiteImage { src: ImageMetadata; alt: string }

const sources = {
  roze, muszle, rozaWrzosowa, krowki, pszczeli, misie, kurka, buldog, wSzkle,
  procesKnot, procesZapach, procesOdlewanie, prezentZielona, prezentAlpaka, moai, czaszka,
  krowaMech, dawid, alpaki, lawenda, buddy, cytryna,
} satisfies Record<keyof typeof alt, ImageMetadata>;

export const IMG = Object.fromEntries(
  Object.entries(sources).map(([key, src]) => [key, { src, alt: alt[key as keyof typeof alt] }]),
) as Record<keyof typeof sources, SiteImage>;
