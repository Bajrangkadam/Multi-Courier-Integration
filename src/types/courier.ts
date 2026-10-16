export type ShipmentStatus =
  | "PENDING" | "CREATED" | "PICKED_UP" | "IN_TRANSIT"
  | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED" | "FAILED";

export interface Address {
  name: string;
  phone: string;
  line1: string;
  line2?: string;
  email?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

export interface NormalizedOrder {
  order_id: string;
  courier_partner: string;
  pickup: Address;
  delivery: Address;
  items: Array<{ sku: string; name: string; quantity: number; unit_price: number; weight_kg?: number }>;
  payment_mode: "PREPAID" | "COD";
  cod_amount?: number;
  declared_value: number;
  currency: string;
  package_dimensions?: { height_cm: number; length_cm: number; width_cm: number };
  metadata?: Record<string, unknown>;
}

export interface CreateShipmentResult {
  courier_order_id: string;
  awb_number: string;
  status: ShipmentStatus;
  request: unknown;
  raw: unknown;
}
export interface TrackingResult {
  status: ShipmentStatus;
  awb_number?: string;
  courier_order_id?: string;
  event_at?: string;
  raw: unknown;
}

export interface CourierAdapter {
  readonly name: string;
  createShipment(order: NormalizedOrder): Promise<CreateShipmentResult>;
  trackShipment(courierOrderId: string, awbNumber?: string): Promise<TrackingResult>;
  cancelShipment(courierOrderId: string, awbNumber?: string): Promise<{ status: ShipmentStatus; raw: unknown }>;
}
