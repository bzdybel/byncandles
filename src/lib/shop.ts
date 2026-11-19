/** Dostęp do katalogu (Keystatic → content collections) i reguły widoczności produktów. */
import { getCollection, getEntry, type CollectionEntry } from 'astro:content';
import { toGrosze } from './money.ts';
import type { ShopConfig } from './pricing.ts';

export type Produkt = CollectionEntry<'produkty'>;
export type ProduktData = Produkt['data'];
export type Kategoria = CollectionEntry<'kategorie'>;
export type Ustawienia = CollectionEntry<'ustawienia'>['data'];

export const cenaAktualna = (p: ProduktData): number => p.cenaPromocyjna ?? p.cena;
export const maPromocje = (p: ProduktData): boolean => p.cenaPromocyjna !== undefined;
export const naStanie = (p: ProduktData): boolean => p.status === 'dostepny' && p.stan > 0;

export const urlProduktu = (p: Produkt) => `/sklep/${p.id}/`;
export const urlKategorii = (k: Kategoria) => `/sklep/kategoria/${k.id}/`;

const ORDER = { dostepny: 0, wkrotce: 1, wyprzedany: 2, ukryty: 3 } as const;
const byName = (a: string, b: string) => a.localeCompare(b, 'pl');

/** Produkty widoczne publicznie: dostępne → wkrótce → wyprzedane, potem alfabetycznie. */
export async function produktyPubliczne(): Promise<Produkt[]> {
  const all = await getCollection('produkty', ({ data }) => data.status !== 'ukryty');
  return all.sort((a, b) => ORDER[a.data.status] - ORDER[b.data.status] || byName(a.data.nazwa, b.data.nazwa));
}

/** Kategorie, które mają co najmniej jeden widoczny produkt (bez pustych stron). */
export async function kategorieZProduktami(produkty: Produkt[]): Promise<Kategoria[]> {
  const used = new Set(produkty.map((p) => p.data.kategoria?.id));
  const all = await getCollection('kategorie', ({ id }) => used.has(id));
  return all.sort((a, b) => a.data.kolejnosc - b.data.kolejnosc || byName(a.data.nazwa, b.data.nazwa));
}

export async function ustawienia(): Promise<Ustawienia> {
  const e = await getEntry('ustawienia', 'sklep');
  if (!e) throw new Error('Brak src/content/ustawienia.yaml — uzupełnij Ustawienia sklepu w panelu Keystatic.');
  return e.data;
}

/** Konfiguracja koszyka w groszach — jedyne miejsce konwersji ustawień sklepu. */
export async function shopConfig(): Promise<ShopConfig> {
  const u = await ustawienia();
  return {
    shipping: toGrosze(u.wysylkaPaczkomat),
    freeFrom: u.darmowaWysylkaOd !== undefined ? toGrosze(u.darmowaWysylkaOd) : undefined,
    promo2plus1: u.promocja2plus1,
  };
}

/** schema.org availability dla statusu. */
export function dostepnoscSchema(p: ProduktData) {
  if (p.status === 'wkrotce') return 'https://schema.org/PreOrder';
  return naStanie(p) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock';
}
