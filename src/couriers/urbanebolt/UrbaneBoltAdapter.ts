import { config } from "../../config";
import { AppError } from "../../errors/AppError";
import { CourierAdapter, NormalizedOrder, ShipmentStatus } from "../../types/courier";
import { requestJson } from "../http";

type TokenResponse = { access_token?: string; token?: string; key?: string; expires_in?: number; data?: TokenResponse };
type AnyRecord = Record<string, any>;

export class UrbaneBoltAdapter implements CourierAdapter {
  readonly name = "urbanebolt";
  private token?: string;
  private tokenExpiresAt = 0;

  private url(path: string) {
    if (!config.urbaneBolt.baseUrl || !path) throw new AppError(503, "COURIER_NOT_CONFIGURED", "UrbaneBolt endpoint is not configured");
    return `${config.urbaneBolt.baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  }

  private async authenticate(force = false): Promise<string> {
    if (!force && this.token && Date.now() < this.tokenExpiresAt - 30000) return this.token;
    if (!config.urbaneBolt.username || !config.urbaneBolt.password) {
      throw new AppError(503, "COURIER_NOT_CONFIGURED", "UrbaneBolt credentials are not configured");
    }
    const result = await requestJson<TokenResponse>(this.url(config.urbaneBolt.authPath), {
      method: "POST", headers: { "content-type": "application/json", ...(config.urbaneBolt.cookie ? { cookie: config.urbaneBolt.cookie } : {}) },
      body: JSON.stringify({ username: config.urbaneBolt.username, password: config.urbaneBolt.password })
    });
    const token = result.access_token ?? result.token ?? result.key ?? result.data?.access_token ?? result.data?.token ?? result.data?.key;
    if (!token) throw new AppError(502, "COURIER_AUTH_FAILED", "Courier authentication failed");
    this.token = token;
    this.tokenExpiresAt = Date.now() + (result.expires_in ?? 3600) * 1000;
    return token;
  }

  private headers(token: string, extra?: HeadersInit): Headers {
    const headers = new Headers(extra);
    headers.set("content-type", "application/json");
    headers.set("authorization", `Bearer ${token}`);
    if (config.urbaneBolt.cookie) headers.set("cookie", config.urbaneBolt.cookie);
    return headers;
  }

  private async call<T>(path: string, init: RequestInit = {}, courierRequest?: unknown): Promise<T> {
    let token = await this.authenticate();
    try {
      return await requestJson<T>(this.url(path), { ...init, headers: this.headers(token, init.headers) });
    } catch (error) {
      if (error instanceof AppError && [401, 403].includes(error.statusCode)) {
        token = await this.authenticate(true);
        try {
          return await requestJson<T>(this.url(path), { ...init, headers: this.headers(token, init.headers) });
        } catch (retryError) {
          this.attachRequest(retryError, courierRequest);
          throw retryError;
        }
      }
      this.attachRequest(error, courierRequest);
      throw error;
    }
  }

  private attachRequest(error: unknown, courierRequest?: unknown) {
    if (error instanceof AppError && courierRequest !== undefined) {
      error.internalContext = { ...error.internalContext, courierRequest };
    }
  }

  async createShipment(order: NormalizedOrder) {
    if (!config.urbaneBolt.customerCode) throw new AppError(503, "COURIER_NOT_CONFIGURED", "UrbaneBolt customer code is not configured");
    if (!order.package_dimensions || order.items.some(item => item.weight_kg === undefined)) {
      throw new AppError(422, "COURIER_PACKAGE_DETAILS_REQUIRED", "UrbaneBolt orders require package dimensions and item weights");
    }
    const pieces = order.items.reduce((total, item) => total + item.quantity, 0);
    const totalWeight = order.items.reduce((total, item) => total + item.quantity * (item.weight_kg ?? 0), 0);
    const addressLine = (address: NormalizedOrder["pickup"]) => [address.line1, address.line2].filter(Boolean).join(", ");
    const payload = [{
      customerCode: config.urbaneBolt.customerCode,
      orderNumber: order.order_id,
      declaredValue: order.declared_value,
      itemDescription: order.items.map(item => item.name).join(", "),
      collectableValue: order.payment_mode === "COD" ? order.cod_amount ?? 0 : 0,
      height: order.package_dimensions.height_cm,
      length: order.package_dimensions.length_cm,
      pieces,
      weight: totalWeight,
      breadth: order.package_dimensions.width_cm,
      serviceType: config.urbaneBolt.serviceType,
      payMode: order.payment_mode,
      rtnCity: order.pickup.city,
      rtnName: order.pickup.name,
      consCity: order.delivery.city,
      consName: order.delivery.name,
      rtnEmail: order.pickup.email ?? "",
      rtnState: order.pickup.state,
      shprCity: order.pickup.city,
      shprName: order.pickup.name,
      consEmail: order.delivery.email ?? "",
      consState: order.delivery.state,
      rtnMobile: order.pickup.phone,
      shprEmail: order.pickup.email ?? "",
      shprState: order.pickup.state,
      consMobile: order.delivery.phone,
      rtnAddress: addressLine(order.pickup),
      rtnAddressType: "Seller",
      rtnCountry: order.pickup.country,
      rtnPincode: order.pickup.postal_code,
      shprMobile: order.pickup.phone,
      consAddress: addressLine(order.delivery),
      consAddressType: "Home",
      consCountry: order.delivery.country,
      consPincode: order.delivery.postal_code,
      invoiceNumber: order.order_id,
      invoiceDate: new Date().toISOString().slice(0, 10),
      shprAddress: addressLine(order.pickup),
      shprAddressType: "Seller",
      shprCountry: order.pickup.country,
      shprPincode: order.pickup.postal_code,
      invoiceValue: order.declared_value,
      itemQuantity: pieces
    }];
    let raw: AnyRecord;
    try {
      raw = await this.call<AnyRecord>(config.urbaneBolt.createOrderPath, {
        method: "POST",
        headers: { "idempotency-key": order.order_id },
        body: JSON.stringify(payload)
      }, payload);
    } catch (error) {
      this.attachRequest(error, payload);
      throw error;
    }
    const response = Array.isArray(raw) ? raw[0] : raw.data ?? raw;
    const courierOrderId = response.order_id ?? response.orderNumber ?? response.id ?? response.shipment_id ?? order.order_id;
    const awb = response.awb_number ?? response.awb ?? response.awbNumber ?? response.tracking_number;
    if (!courierOrderId || !awb) {
      throw new AppError(502, "COURIER_INVALID_RESPONSE", "Courier response did not contain shipment identifiers", undefined, false, {
        courierRequest: payload,
        courierResponse: raw
      });
    }
    return { courier_order_id: String(courierOrderId), awb_number: String(awb), status: this.mapStatus(raw.status), request: payload, raw };
  }

  async trackShipment(courierOrderId: string, awbNumber?: string) {
    const path = config.urbaneBolt.trackPath
      .replace("{shipmentId}", encodeURIComponent(courierOrderId))
      .replace("{awb}", encodeURIComponent(awbNumber ?? courierOrderId));
    const raw = await this.call<AnyRecord>(path, { method: "GET" });
    const tracking = Array.isArray(raw) ? raw[0] : raw.data ?? raw;
    return { status: this.mapStatus(tracking.status ?? tracking.shipment_status ?? tracking.currentStatus),
      awb_number: tracking.awb_number ?? tracking.awbNumber ?? tracking.awb ?? awbNumber,
      courier_order_id: String(tracking.order_id ?? tracking.orderNumber ?? tracking.id ?? courierOrderId),
      event_at: tracking.updated_at ?? tracking.event_at ?? tracking.eventAt, raw };
  }

  async cancelShipment(courierOrderId: string, awbNumber?: string) {
    const path = config.urbaneBolt.cancelPath.replace("{shipmentId}", encodeURIComponent(courierOrderId));
    const raw = await this.call<AnyRecord>(path, { method: "POST", body: JSON.stringify({ awbs: awbNumber ?? courierOrderId }) });
    const cancellation = Array.isArray(raw) ? raw[0] : raw.data ?? raw;
    return { status: this.mapStatus(cancellation.status ?? cancellation.shipment_status ?? "CANCELLED"), raw };
  }

  private mapStatus(value: unknown): ShipmentStatus {
    if (value === undefined || value === null || value === "") return "CREATED";
    if (typeof value !== "string") throw new AppError(502, "COURIER_UNKNOWN_STATUS", "Courier returned an unsupported shipment status");
    const status = value.toUpperCase().replace(/[\s-]+/g, "_");
    const known: ShipmentStatus[] = ["PENDING", "CREATED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "FAILED"];
    if (known.includes(status as ShipmentStatus)) return status as ShipmentStatus;
    const aliases: Record<string, ShipmentStatus> = { SHIPPED: "IN_TRANSIT", DISPATCHED: "IN_TRANSIT", COMPLETE: "DELIVERED", COMPLETED: "DELIVERED", BOOKED: "CREATED" };
    const mapped = aliases[status];
    if (mapped) return mapped;
    throw new AppError(502, "COURIER_UNKNOWN_STATUS", "Courier returned an unsupported shipment status");
  }
}
