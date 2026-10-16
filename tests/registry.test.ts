import { CourierRegistry } from "../src/couriers/registry";
import { MockCourierAdapter } from "../src/couriers/mock/MockCourierAdapter";

describe("CourierRegistry", () => {
  it("registers and resolves courier adapters case-insensitively", () => {
    const registry = new CourierRegistry();
    registry.register(new MockCourierAdapter());
    expect(registry.get("MOCKCOURIER").name).toBe("mockcourier");
  });
  it("rejects unknown couriers with supported list", () => {
    const registry = new CourierRegistry();
    registry.register(new MockCourierAdapter());
    expect(() => registry.get("missing")).toThrow(/Supported couriers: mockcourier/);
  });
});
