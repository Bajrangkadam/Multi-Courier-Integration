import { randomUUID } from "node:crypto";
import { CourierAdapter, NormalizedOrder, ShipmentStatus } from "../../types/courier";

export class MockCourierAdapter implements CourierAdapter {
  readonly name = "mockcourier";
  async createShipment(order: NormalizedOrder) {
    const raw = { id: `MOCK-${order.order_id}`, awb: `AWB-${randomUUID().slice(0, 8).toUpperCase()}`, status: "CREATED" };
    return { courier_order_id: raw.id, awb_number: raw.awb, status: "CREATED" as ShipmentStatus, request: order, raw };
  }
  async trackShipment(courierOrderId: string, awbNumber?: string) {
    const raw = { id: courierOrderId, awb: awbNumber, status: "IN_TRANSIT", event_at: new Date().toISOString() };
    return { status: "IN_TRANSIT" as ShipmentStatus, awb_number: awbNumber, courier_order_id: courierOrderId, event_at: raw.event_at, raw };
  }
  async cancelShipment(courierOrderId: string) {
    return { status: "CANCELLED" as ShipmentStatus, raw: { id: courierOrderId, status: "CANCELLED" } };
  }
}
