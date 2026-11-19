import { getCollection, getEntry, type CollectionEntry } from 'astro:content';

export type Produkt = CollectionEntry<'produkty'>;
export type Kategoria = CollectionEntry<'kategorie'>;

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
export const formatPLN = (zl: number) => pln.format(zl);

/** Ceny trzymamy w zł z panelu; do obliczeń/płatności zawsze w groszach. */
export const toGrosze = (zl: number) => Math.round(zl * 100);

export const cenaAktualna = (p: Produkt['data']) => p.cenaPromocyjna ?? p.cena;

export const STATUS_LABEL: Record<Produkt['data']['status'], string> = {
  dostepny: 'Dostępny',
  wkrotce: 'Wkrótce',
  wyprzedany: 'Wyprzedany',
  ukryty: 'Ukryty',
};

/** Czy produkt można teraz kupić. */
export const naStanie = (p: Produkt['data']) => p.status === 'dostepny' && p.stan > 0;

/** Produkty widoczne publicznie, posortowane: dostępne → wkrótce → wyprzedane, potem alfabetycznie. */
export async function produktyPubliczne(): Promise<Produkt[]> {
  const order = { dostepny: 0, wkrotce: 1, wyprzedany: 2, ukryty: 3 } as const;
  const all = await getCollection('produkty', ({ data }) => data.status !== 'ukryty');
  return all.sort(
    (a, b) => order[a.data.status] - order[b.data.status] || a.data.nazwa.localeCompare(b.data.nazwa, 'pl'),
  );
}

export async function kategorie(): Promise<Kategoria[]> {
  const all = await getCollection('kategorie');
  return all.sort((a, b) => a.data.kolejnosc - b.data.kolejnosc || a.data.nazwa.localeCompare(b.data.nazwa, 'pl'));
}

export type Ustawienia = CollectionEntry<'ustawienia'>['data'];

export async function ustawienia(): Promise<Ustawienia> {
  const e = await getEntry('ustawienia', 'sklep');
  return e?.data ?? { wysylkaPaczkomat: 0, email: undefined, wysylkaKurier: undefined, darmowaWysylkaOd: undefined, promocja2plus1: false, producent: undefined };
}

export const urlProduktu = (p: Produkt) => `/sklep/${p.id}/`;
export const urlKategorii = (k: Kategoria) => `/sklep/kategoria/${k.id}/`;

/** schema.org availability dla statusu. */
export function dostepnoscSchema(p: Produkt['data']) {
  if (p.status === 'wkrotce') return 'https://schema.org/PreOrder';
  return naStanie(p) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock';
}
