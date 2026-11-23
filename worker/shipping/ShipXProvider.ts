/**
 * InPost ShipX: przesyłka paczkomatowa zakładana po opłaceniu zamówienia.
 * Pojawia się w Managerze Paczek - sklep drukuje etykietę (i opłaca, jeśli konto nie ma umowy).
 * Dokumentacja: https://dokumentacja-inpost.atlassian.net/wiki/spaces/PL/pages/622754/API+ShipX
 */
import { ProviderError } from '../errors/AppError.ts';
import { callProvider, defaultFetch } from '../utils/providerHttp.ts';
import type { ShipmentInput, ShipmentResult, ShippingProvider } from './ShippingProvider.ts';

export interface ShipXConfig {
  token: string;
  organizationId: string;
  sandbox: boolean;
  /** small (A), medium (B), large (C) */
  parcelTemplate: string;
  /** parcel_locker | dispatch_order | pop */
  sendingMethod: string;
}

export const shipxHost = (sandbox: boolean) => (sandbox ? 'https://sandbox-api-shipx-pl.easypack24.net' : 'https://api-shipx-pl.easypack24.net');

/** Czysta funkcja: treść żądania (osobno - do testów i do logów). */
export function shipmentBody(cfg: Pick<ShipXConfig, 'parcelTemplate' | 'sendingMethod'>, o: ShipmentInput) {
  const [first, ...rest] = o.customerName.trim().split(/\s+/);
  return {
    receiver: { first_name: first, last_name: rest.join(' '), email: o.email, phone: o.phone },
    parcels: { template: cfg.parcelTemplate },
    custom_attributes: { target_point: o.deliveryPointId, sending_method: cfg.sendingMethod },
    service: 'inpost_locker_standard',
    reference: o.orderNumber,
  };
}

export class ShipXProvider implements ShippingProvider {
  readonly name = 'inpost_shipx';
  private readonly cfg: ShipXConfig;
  private readonly fetchFn: typeof fetch;

  constructor(cfg: ShipXConfig, fetchFn: typeof fetch = defaultFetch) {
    this.cfg = cfg;
    this.fetchFn = fetchFn;
  }

  async createShipment(input: ShipmentInput): Promise<ShipmentResult> {
    const { ok, status, json } = await callProvider<{ id?: number | string; status?: string; message?: string; error?: string }>(
      this.name,
      `${shipxHost(this.cfg.sandbox)}/v1/organizations/${this.cfg.organizationId}/shipments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.token}` },
        body: JSON.stringify(shipmentBody(this.cfg, input)),
      },
      this.fetchFn,
    );
    // Pełna odpowiedź w błędzie: ShipX opisuje w `details`, które pole odrzucił (np. zły kod paczkomatu).
    if (!ok || json.id === undefined) throw new ProviderError(this.name, `HTTP ${status} ${json.error ?? ''} ${json.message ?? ''}`.trim(), { response: json });
    return { id: String(json.id), status: json.status ?? 'created' };
  }
}
