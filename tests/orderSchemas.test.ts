import { bulkSchema } from "../src/validation/orderSchemas";
import { NormalizedOrder } from "../src/types/courier";

const order: NormalizedOrder = {
  order_id: "ORDER-1",
  courier_partner: "mockcourier",
  pickup: { name: "Warehouse", phone: "9999999999", line1: "Road 1", city: "Pune", state: "MH", postal_code: "411001", country: "India" },
  delivery: { name: "Customer", phone: "8888888888", line1: "Road 2", city: "Mumbai", state: "MH", postal_code: "400001", country: "India" },
  items: [{ sku: "SKU-1", name: "Book", quantity: 1, unit_price: 100 }],
  payment_mode: "PREPAID",
  declared_value: 100,
  currency: "INR"
};

describe("bulk order validation", () => {
  it("accepts up to 100 orders", () => {
    expect(bulkSchema.safeParse({ orders: Array.from({ length: 100 }, (_, index) => ({ ...order, order_id: `ORDER-${index}` })) }).success).toBe(true);
  });

  it("rejects repeated order IDs within a batch", () => {
    const result = bulkSchema.safeParse({ orders: [order, order] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ["orders", 1, "order_id"] })
      ]));
    }
  });

  it("rejects batches larger than 100", () => {
    const orders = Array.from({ length: 101 }, (_, index) => ({ ...order, order_id: `ORDER-${index}` }));
    expect(bulkSchema.safeParse({ orders }).success).toBe(false);
  });

  it("requires UrbaneBolt package dimensions and item weights", () => {
    const result = bulkSchema.safeParse({ orders: [{ ...order, courier_partner: "urbanebolt" }] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map(issue => issue.path)).toEqual(expect.arrayContaining([
        ["orders", 0, "package_dimensions"],
        ["orders", 0, "items", 0, "weight_kg"]
      ]));
    }
  });
});