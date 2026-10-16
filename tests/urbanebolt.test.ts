import { config } from "../src/config";
import { UrbaneBoltAdapter } from "../src/couriers/urbanebolt/UrbaneBoltAdapter";
import { NormalizedOrder } from "../src/types/courier";
import { vi } from "vitest";

const order: NormalizedOrder = {
  order_id: "ORDER-1",
  courier_partner: "urbanebolt",
  pickup: { name: "Warehouse", phone: "9999999999", line1: "Road 1", city: "Pune", state: "MH", postal_code: "411001", country: "India" },
  delivery: { name: "Customer", phone: "8888888888", line1: "Road 2", city: "Mumbai", state: "MH", postal_code: "400001", country: "India" },
  items: [{ sku: "SKU-1", name: "Book", quantity: 1, unit_price: 100, weight_kg: 1.1 }],
  payment_mode: "PREPAID",
  declared_value: 100,
  currency: "INR",
  package_dimensions: { height_cm: 10, length_cm: 12, width_cm: 10 }
};

const originalConfig = { ...config.urbaneBolt };
function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}

describe("UrbaneBoltAdapter", () => {
  let fetchMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    Object.assign(config.urbaneBolt, {
      baseUrl: "https://uat.urbanebolt.in",
      username: "uat-user",
      password: "uat-password",
      customerCode: "CUSTOMER-1",
      authPath: "/api/v1/auth/getToken/",
      createOrderPath: "/api/v1/services/manifest/",
      trackPath: "/api/v1/services/tracking-pub/?awb={awb}",
      cancelPath: "/api/v1/services/cancel/"
    });
    fetchMock = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchMock.mockRestore();
    Object.assign(config.urbaneBolt, originalConfig);
  });

  it("uses the documented username/password token flow and stable order reference", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ access_token: "uat-token", expires_in: 3600 }))
      .mockResolvedValueOnce(response({ order_id: "COURIER-1", awb_number: "AWB-1", status: "BOOKED" }));

    const result = await new UrbaneBoltAdapter().createShipment(order);
    const authCall = fetchMock.mock.calls[0];
    const shipmentCall = fetchMock.mock.calls[1];

    expect(authCall[0]).toBe("https://uat.urbanebolt.in/api/v1/auth/getToken/");
    expect(JSON.parse(String(authCall[1]?.body))).toEqual({ username: "uat-user", password: "uat-password" });
    expect(shipmentCall[0]).toBe("https://uat.urbanebolt.in/api/v1/services/manifest/");
    const shipmentHeaders = new Headers(shipmentCall[1]?.headers);
    expect(shipmentHeaders.get("authorization")).toBe("Bearer uat-token");
    expect(shipmentHeaders.get("idempotency-key")).toBe("ORDER-1");
    expect(result).toMatchObject({ courier_order_id: "COURIER-1", awb_number: "AWB-1", status: "CREATED" });
    expect(result.request).toEqual(expect.arrayContaining([
      expect.objectContaining({ customerCode: "CUSTOMER-1", orderNumber: "ORDER-1", pieces: 1 })
    ]));
  });

  it("tracks by AWB and cancels using the documented awbs body", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ access_token: "uat-token", expires_in: 3600 }))
      .mockResolvedValueOnce(response({ status: "IN_TRANSIT", awb_number: "AWB-1" }))
      .mockResolvedValueOnce(response({ status: "CANCELLED" }));
    const adapter = new UrbaneBoltAdapter();

    expect((await adapter.trackShipment("COURIER-1", "AWB-1")).status).toBe("IN_TRANSIT");
    expect(await adapter.cancelShipment("COURIER-1", "AWB-1")).toMatchObject({ status: "CANCELLED" });
    expect(fetchMock.mock.calls[1][0]).toBe("https://uat.urbanebolt.in/api/v1/services/tracking-pub/?awb=AWB-1");
    expect(fetchMock.mock.calls[2][0]).toBe("https://uat.urbanebolt.in/api/v1/services/cancel/");
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({ awbs: "AWB-1" });
  });

  it("refreshes authentication once after a provider 401", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ access_token: "expired-token" }))
      .mockResolvedValueOnce(response({ message: "expired" }, 401))
      .mockResolvedValueOnce(response({ access_token: "fresh-token" }))
      .mockResolvedValueOnce(response({ order_id: "COURIER-1", awb_number: "AWB-1", status: "BOOKED" }));

    await new UrbaneBoltAdapter().createShipment(order);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(new Headers(fetchMock.mock.calls[3][1]?.headers).get("authorization")).toBe("Bearer fresh-token");
  });

  it("requires package measurements and weights for a Manifest request", async () => {
    await expect(new UrbaneBoltAdapter().createShipment({ ...order, package_dimensions: undefined }))
      .rejects.toMatchObject({ code: "COURIER_PACKAGE_DETAILS_REQUIRED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});