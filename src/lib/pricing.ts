/**
 * Reguły cenowe koszyka - czyste funkcje, wspólne dla przeglądarki i (w przyszłości) API zamówień.
 * Źródłem prawdy przy płatności będzie serwer: przeliczy ceny i zarezerwuje stan atomowo,
 * bo wielu klientów może jednocześnie kupować ostatnią sztukę. Tu liczymy podgląd dla klienta.
 */
import type { Grosze } from './money.ts';

export interface CartLine {
  id: string;
  price: Grosze;
  qty: number;
}

export interface ShopConfig {
  shipping: Grosze; // Paczkomat InPost
  freeFrom?: Grosze; // darmowa dostawa od (po rabatach)
  promo2plus1: boolean;
}

export interface Totals {
  count: number;
  subtotal: Grosze;
  discount: Grosze;
  shipping: Grosze;
  total: Grosze;
  /** Ile brakuje do darmowej dostawy; undefined, gdy próg nie istnieje lub jest osiągnięty. */
  missingForFree?: Grosze;
  /** Postęp do darmowej dostawy 0-1; undefined, gdy brak progu. */
  freeProgress?: number;
}

/** 2+1: w każdej trójce sztuk najtańsza gratis - rabat liczony od najtańszych sztuk w całym koszyku. */
export function promoDiscount(lines: readonly CartLine[]): Grosze {
  const units = lines.flatMap((l) => Array<Grosze>(l.qty).fill(l.price)).sort((a, b) => a - b);
  return units.slice(0, Math.floor(units.length / 3)).reduce((sum, p) => sum + p, 0);
}

export function totals(lines: readonly CartLine[], cfg: ShopConfig): Totals {
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const discount = cfg.promo2plus1 ? promoDiscount(lines) : 0;
  const net = subtotal - discount;
  const hasThreshold = cfg.freeFrom !== undefined;
  const isFree = hasThreshold && net >= cfg.freeFrom!;
  const shipping = count === 0 || isFree ? 0 : cfg.shipping;
  return {
    count,
    subtotal,
    discount,
    shipping,
    total: net + shipping,
    missingForFree: hasThreshold && !isFree ? cfg.freeFrom! - net : undefined,
    freeProgress: hasThreshold ? Math.min(1, cfg.freeFrom! === 0 ? 1 : net / cfg.freeFrom!) : undefined,
  };
}
