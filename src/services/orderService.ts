import { AppError } from "../errors/AppError";
import { courierRegistry } from "../couriers";
import { NormalizedOrder } from "../types/courier";
import { orderRepository } from "./orderRepository";
import { config } from "../config";
import { logger } from "../logger";

export class OrderService {
  private async withRetries<T>(operation: () => Promise<T>, orderId: string, courierPartner: string, requestId?: string): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await operation();
      } catch (error) {
        const appError = error instanceof AppError ? error : new AppError(502, "COURIER_ERROR", "Courier operation failed", undefined, false);
        if (!appError.retryable || attempt >= config.courierMaxRetries) throw appError;
        logger.warn({ orderId, courierPartner, requestId, attempt, errorCode: appError.code }, "Retrying transient courier failure");
        await new Promise(resolve => setTimeout(resolve, config.courierRetryBaseDelayMs * 2 ** (attempt - 1)));
      }
    }
  }

  async create(order: NormalizedOrder, requestId?: string) {
    const adapter = courierRegistry.get(order.courier_partner);
    const created = await orderRepository.createPending(order, requestId);
    if (created.duplicate) {
      return { order_id: created.row.order_id, status: created.row.status, courier_partner: created.row.courier_partner,
        awb_number: created.row.awb_number, duplicate: true };
    }
    try {
      const result = await this.withRetries(() => adapter.createShipment(order), order.order_id, order.courier_partner, requestId);
      await orderRepository.markCreated(created.row.id, result, result.status);
      return { order_id: order.order_id, courier_partner: order.courier_partner, courier_order_id: result.courier_order_id,
        awb_number: result.awb_number, status: result.status, duplicate: false };
    } catch (error) {
      const e = error instanceof AppError ? error : new AppError(502, "COURIER_ERROR", "Courier shipment creation failed");
      await orderRepository.markFailure(created.row.id, e.code, e.message, e.internalContext);
      logger.error({ orderId: order.order_id, courierPartner: order.courier_partner, requestId, err: error }, "Courier create failed");
      throw new AppError(e.statusCode, e.code, "Courier shipment creation failed");
    }
  }

  async createBulk(orders: NormalizedOrder[], requestId: string) {
    for (const order of orders) courierRegistry.get(order.courier_partner);
    const batch = await orderRepository.createBulkBatch(orders, requestId);
    return { ...batch, status: "QUEUED" };
  }

  async track(orderId: string, requestId?: string) {
    const row = await orderRepository.getByOrderId(orderId);
    if (!row) throw new AppError(404, "ORDER_NOT_FOUND", "Order was not found");
    if (!row.courier_order_id) {
      return { order_id: row.order_id, courier_partner: row.courier_partner, status: row.status, history: await orderRepository.tracking(row.id) };
    }
    const adapter = courierRegistry.get(row.courier_partner);
    let result;
    try {
      result = await this.withRetries(() => adapter.trackShipment(row.courier_order_id, row.awb_number), row.order_id, row.courier_partner, requestId);
    } catch (error) {
      const appError = error instanceof AppError ? error : new AppError(502, "COURIER_TRACK_FAILED", "Courier tracking failed");
      await orderRepository.recordOperationFailure(row.id, row.status, "track", appError.code, appError.message, appError.internalContext?.courierResponse);
      logger.error({ orderId: row.order_id, courierPartner: row.courier_partner, requestId, err: error }, "Courier tracking failed");
      throw new AppError(appError.statusCode, appError.code, "Courier tracking failed");
    }
    await orderRepository.updateStatus(row.id, result.status, result.raw);
    return { order_id: row.order_id, courier_partner: row.courier_partner, awb_number: result.awb_number ?? row.awb_number,
      status: result.status, latest_event_at: result.event_at, history: await orderRepository.tracking(row.id) };
  }

  async cancel(orderId: string, requestId?: string) {
    const row = await orderRepository.getByOrderId(orderId);
    if (!row) throw new AppError(404, "ORDER_NOT_FOUND", "Order was not found");
    if (!row.courier_order_id) throw new AppError(409, "ORDER_NOT_READY", "Shipment has not been created by courier yet");
    if (row.status === "CANCELLED") return { order_id: row.order_id, status: "CANCELLED", already_cancelled: true };
    const adapter = courierRegistry.get(row.courier_partner);
    try {
      const result = await this.withRetries(() => adapter.cancelShipment(row.courier_order_id, row.awb_number), row.order_id, row.courier_partner, requestId);
      await orderRepository.updateStatus(row.id, result.status, result.raw);
      return { order_id: row.order_id, status: result.status };
    } catch (error) {
      const appError = error instanceof AppError ? error : new AppError(502, "COURIER_CANCEL_FAILED", "Courier cancellation failed");
      await orderRepository.recordOperationFailure(row.id, row.status, "cancel", appError.code, appError.message, appError.internalContext?.courierResponse);
      logger.error({ orderId, courierPartner: row.courier_partner, requestId, err: error }, "Courier cancel failed");
      throw new AppError(appError.statusCode, appError.code, "Courier cancellation failed");
    }
  }

  async batch(batchId: string) {
    const result = await orderRepository.batch(batchId);
    if (!result) throw new AppError(404, "BATCH_NOT_FOUND", "Batch was not found");
    return result;
  }
}
export const orderService = new OrderService();
