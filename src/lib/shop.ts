/** Dostęp do katalogu (Keystatic → content collections) i reguły widoczności produktów. */
import { getCollection, getEntry, type CollectionEntry } from 'astro:content';
import { toGrosze } from './money.ts';
import type { ShopConfig } from './pricing.ts';

type ProduktWpis = CollectionEntry<'produkty'>;
/** Produkt z ustaloną ceną: własną z pliku produktu albo domyślną z ustawień sklepu. */
export type ProduktData = Omit<ProduktWpis['data'], 'cena'> & { cena: number };
export type Produkt = Omit<ProduktWpis, 'data'> & { data: ProduktData };
export type Kategoria = CollectionEntry<'kategorie'>;
export type Ustawienia = CollectionEntry<'ustawienia'>['data'];

export const cenaAktualna = (p: ProduktData): number => p.cenaPromocyjna ?? p.cena;
export const maPromocje = (p: ProduktData): boolean => p.cenaPromocyjna !== undefined;
export const naStanie = (p: ProduktData): boolean => p.status === 'dostepny' && p.stan > 0;

export const urlProduktu = (p: Produkt) => `/sklep/${p.id}/`;
export const urlKategorii = (k: Kategoria) => `/sklep/kategoria/${k.id}/`;

const ORDER = { dostepny: 0, wkrotce: 1, wyprzedany: 2, ukryty: 3 } as const;
const byName = (a: string, b: string) => a.localeCompare(b, 'pl');

/** Uzupełnia cenę domyślną i pilnuje, żeby promocja była niższa od ceny - błąd zatrzymuje build. */
function zCena(wpis: ProduktWpis, cenaDomyslna: number | undefined): Produkt {
  const cena = wpis.data.cena ?? cenaDomyslna;
  const plik = `src/content/produkty/${wpis.id}.yaml`;
  if (cena === undefined) {
    throw new Error(`${plik}: brak ceny - wpisz „cena” w produkcie albo „cenaDomyslna” w src/content/ustawienia.yaml.`);
  }
  if (wpis.data.cenaPromocyjna !== undefined && wpis.data.cenaPromocyjna >= cena) {
    throw new Error(`${plik}: cena promocyjna (${wpis.data.cenaPromocyjna} zł) musi być niższa od ceny (${cena} zł).`);
  }
  return { ...wpis, data: { ...wpis.data, cena } };
}

/** Produkty widoczne publicznie: dostępne → wkrótce → wyprzedane, potem alfabetycznie. Jedyne wejście do katalogu. */
export async function produktyPubliczne(): Promise<Produkt[]> {
  const [wpisy, u] = await Promise.all([
    getCollection('produkty', ({ data }) => data.status !== 'ukryty'),
    ustawienia(),
  ]);
  const all = wpisy.map((w) => zCena(w, u.cenaDomyslna));
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
  if (!e) throw new Error('Brak src/content/ustawienia.yaml - uzupełnij Ustawienia sklepu w panelu Keystatic.');
  return e.data;
}

/** Konfiguracja koszyka w groszach - jedyne miejsce konwersji ustawień sklepu. */
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
