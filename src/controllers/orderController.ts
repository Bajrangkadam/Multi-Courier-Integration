import { Request, Response, NextFunction } from "express";
import { orderService } from "../services/orderService";
import { orderRepository } from "../services/orderRepository";
import { courierRegistry } from "../couriers";
import { AppError } from "../errors/AppError";

export async function createOrder(req: Request, res: Response, next: NextFunction) {
  try { res.status(201).json({ success: true, data: await orderService.create(req.body, res.locals.requestId), request_id: res.locals.requestId }); }
  catch (e) { next(e); }
}
export async function createBulk(req: Request, res: Response, next: NextFunction) {
  try { res.status(202).json({ success: true, data: await orderService.createBulk(req.body.orders, res.locals.requestId), request_id: res.locals.requestId }); }
  catch (e) { next(e); }
}
export async function trackOrder(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, data: await orderService.track(String(req.params.orderId ?? ""), res.locals.requestId), request_id: res.locals.requestId }); }
  catch (e) { next(e); }
}
export async function cancelOrder(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, data: await orderService.cancel(String(req.params.orderId ?? ""), res.locals.requestId), request_id: res.locals.requestId }); }
  catch (e) { next(e); }
}
export async function getBatch(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, data: await orderService.batch(String(req.params.batchId ?? "")), request_id: res.locals.requestId }); }
  catch (e) { next(e); }
}
export async function getOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const row = await orderRepository.getByOrderId(String(req.params.orderId ?? ""));
    if (!row) throw new AppError(404, "ORDER_NOT_FOUND", "Order was not found");
    res.json({ success: true, data: row, request_id: res.locals.requestId });
  } catch (e) { next(e); }
}
export function supportedCouriers(_req: Request, res: Response) {
  res.json({ success: true, data: { couriers: courierRegistry.supported() }, request_id: res.locals.requestId });
}
