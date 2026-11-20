/** Pomocnicze funkcje do tekstów z `src/i18n/pl.ts`. Czyste, bez zależności - działają na serwerze i w przeglądarce. */

/** Wstawia zmienne: fill('Zostało {n} szt.', { n: 2 }) → 'Zostało 2 szt.' */
export function fill(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

/** Polska odmiana: plural(5, ['produkt', 'produkty', 'produktów']) → 'produktów' */
export function plural(n: number, [one, few, many]: readonly [string, string, string]): string {
  if (n === 1) return one;
  const d = n % 10;
  const t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
}
