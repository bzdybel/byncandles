/** Wspólne renderowanie koszyka (panel + strona zamówienia). Tylko DOM - logika cen w pricing.ts. */
import { cart as t } from '../i18n/pl.ts';
import { fill, plural } from '../lib/i18n.ts';
import { formatGrosze } from '../lib/money.ts';
import type { Totals } from '../lib/pricing.ts';

const set = (root: ParentNode, key: string, text: string) => {
  const el = root.querySelector<HTMLElement>(`[data-t="${key}"]`);
  if (el) el.textContent = text;
};
const show = (root: ParentNode, key: string, visible: boolean) => {
  const el = root.querySelector<HTMLElement>(`[data-row="${key}"]`);
  if (el) el.hidden = !visible;
};

/** Wypełnia komponent CartTotals.astro. */
export function renderTotals(root: ParentNode, totals: Totals): void {
  set(root, 'subtotal', formatGrosze(totals.subtotal));
  set(root, 'discount', `−${formatGrosze(totals.discount)}`);
  set(root, 'shipping', totals.shipping === 0 ? t.free : formatGrosze(totals.shipping));
  set(root, 'total', formatGrosze(totals.total));
  show(root, 'discount', totals.discount > 0);
}

/** Licznik i etykieta przycisku koszyka w nagłówku. */
export function renderCount(count: number): void {
  document.querySelectorAll<HTMLElement>('[data-cart-count]').forEach((el) => {
    el.textContent = String(count);
    el.hidden = count === 0;
  });
  const label = count === 0 ? t.open : fill(t.openWithCount, { n: count, products: plural(count, t.products) });
  document.querySelectorAll<HTMLElement>('[data-cart-open]').forEach((el) => el.setAttribute('aria-label', label));
}

/** Komunikat dla czytników ekranu (jeden region aria-live na stronę - w CartDrawer.astro). */
export function announce(message: string): void {
  const live = document.querySelector<HTMLElement>('[data-cart-live]');
  if (live) live.textContent = message;
}
