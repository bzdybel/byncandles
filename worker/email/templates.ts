/** Treść e-maili - czyste funkcje (teksty z src/i18n/pl.ts → `emails`). */
import { cart, emails as t } from '../../src/i18n/pl.ts';
import { fill } from '../../src/lib/i18n.ts';
import { formatGrosze } from '../../src/lib/money.ts';
import type { Order, OrderItem } from '../domain/order.ts';

/** Część wspólna: pozycje, rabat, dostawa, suma, prezent, uwagi. */
function summary(order: Order, items: OrderItem[]): string[] {
  return [
    fill(t.number, { number: order.number }),
    '',
    ...items.map((i) => fill(t.line, { name: i.name, qty: i.quantity, price: formatGrosze(i.unitPrice * i.quantity) })),
    ...(order.discount ? [fill(t.discount, { price: formatGrosze(order.discount) })] : []),
    fill(t.shipping, { locker: order.deliveryPointId, price: order.deliveryCost ? formatGrosze(order.deliveryCost) : cart.free }),
    fill(t.total, { price: formatGrosze(order.total) }),
    ...(order.gift ? [t.gift] : []),
    ...(order.notes ? [fill(t.notes, { notes: order.notes })] : []),
  ];
}

export function customerConfirmation(order: Order, items: OrderItem[], origin: string) {
  const firstName = order.customerName.split(/\s+/)[0];
  return {
    subject: fill(t.customerSubject, { number: order.number }),
    text: [
      fill(t.customerGreeting, { name: firstName }),
      '',
      t.customerIntro,
      '',
      ...summary(order, items),
      '',
      t.customerShipping,
      t.customerQuestions,
      '',
      t.customerSignature,
      '',
      fill(t.legal, { url: `${origin}/regulamin/` }),
    ].join('\n'),
  };
}

export type ShipmentOutcome = { kind: 'created'; id: string } | { kind: 'failed'; error: string } | { kind: 'disabled' };

const shipmentLine = (s: ShipmentOutcome) =>
  s.kind === 'created' ? fill(t.shopShipmentOk, { id: s.id }) : s.kind === 'failed' ? fill(t.shopShipmentFailed, { error: s.error }) : t.shopShipmentDisabled;

export function shopNotification(
  order: Order,
  items: OrderItem[],
  opts: { shipment: ShipmentOutcome; paidLate: boolean; customerEmailSent: boolean; adminUrl: string },
) {
  return {
    subject: fill(t.shopSubject, { number: order.number, total: formatGrosze(order.total) }),
    text: [
      ...(opts.paidLate ? [t.shopLate, ''] : []),
      ...(opts.customerEmailSent ? [] : [t.shopCustomerEmailFailed, '']),
      shipmentLine(opts.shipment),
      '',
      ...summary(order, items),
      '',
      fill(t.shopCustomer, { name: order.customerName, email: order.email, phone: order.phone }),
      '',
      fill(t.shopDetails, { url: opts.adminUrl }),
    ].join('\n'),
  };
}
