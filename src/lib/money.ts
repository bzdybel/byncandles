/**
 * Kwoty: w panelu Natalia wpisuje złote, cała logika i płatności operują na groszach (liczby całkowite).
 * Konwersja zł → grosze odbywa się wyłącznie tutaj.
 */
export type Grosze = number;

export const toGrosze = (zl: number): Grosze => Math.round(zl * 100);

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

export const formatGrosze = (g: Grosze): string => pln.format(g / 100);

/** Skrót dla wartości z panelu (zł). */
export const formatZl = (zl: number): string => formatGrosze(toGrosze(zl));
