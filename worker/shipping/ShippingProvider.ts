/** Port wysyłki: InPost ShipX lub noop (MOCK_INPOST=1). */

export interface ShipmentInput {
  orderNumber: string;
  customerName: string;
  email: string;
  phone: string;
  deliveryPointId: string;
}

export interface ShipmentResult {
  id: string;
  status: string;
}

export interface ShippingProvider {
  readonly name: string;
  createShipment(input: ShipmentInput): Promise<ShipmentResult>;
}
