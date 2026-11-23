/** Wysyłka „na niby” (MOCK_INPOST=1) - zwraca sztuczne ID, nic nie zakłada w InPost. */
import type { ShipmentInput, ShipmentResult, ShippingProvider } from './ShippingProvider.ts';

export class ShippingNoop implements ShippingProvider {
  readonly name = 'noop';
  async createShipment(input: ShipmentInput): Promise<ShipmentResult> {
    return { id: `mock-${input.orderNumber}`, status: 'created' };
  }
}
