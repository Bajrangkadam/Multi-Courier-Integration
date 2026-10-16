import { MockCourierAdapter } from "../src/couriers/mock/MockCourierAdapter";
import { NormalizedOrder } from "../src/types/courier";

const sample: NormalizedOrder = {
  order_id: "ORDER-100", courier_partner: "mockcourier",
  pickup: { name: "Warehouse", phone: "9999999999", line1: "Street 1", city: "Pune", state: "MH", postal_code: "411001", country: "India" },
  delivery: { name: "Customer", phone: "8888888888", line1: "Street 2", city: "Mumbai", state: "MH", postal_code: "400001", country: "India" },
  items: [{ sku: "SKU-1", name: "Book", quantity: 1, unit_price: 500 }],
  payment_mode: "PREPAID", declared_value: 500, currency: "INR"
};
describe("MockCourierAdapter", () => {
  it("creates, tracks, and cancels a shipment", async () => {
    const adapter = new MockCourierAdapter();
    const created = await adapter.createShipment(sample);
    expect(created.status).toBe("CREATED");
    expect(created.awb_number).toContain("AWB-");
    expect((await adapter.trackShipment(created.courier_order_id, created.awb_number)).status).toBe("IN_TRANSIT");
    expect((await adapter.cancelShipment(created.courier_order_id)).status).toBe("CANCELLED");
  });
});
