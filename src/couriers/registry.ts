import { AppError } from "../errors/AppError";
import { CourierAdapter } from "../types/courier";

export class CourierRegistry {
  private readonly adapters = new Map<string, CourierAdapter>();
  register(adapter: CourierAdapter): void {
    const key = adapter.name.toLowerCase();
    if (this.adapters.has(key)) throw new Error(`Courier adapter already registered: ${key}`);
    this.adapters.set(key, adapter);
  }
  get(name: string): CourierAdapter {
    const adapter = this.adapters.get(name.toLowerCase());
    if (!adapter) throw new AppError(400, "UNSUPPORTED_COURIER", `Unsupported courier_partner. Supported couriers: ${this.supported().join(", ")}`, { supported_couriers: this.supported() });
    return adapter;
  }
  supported(): string[] { return [...this.adapters.keys()]; }
}
