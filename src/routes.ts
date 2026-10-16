import { Router } from "express";
import { bulkSchema, orderSchema } from "./validation/orderSchemas";
import { createBulk, createOrder, trackOrder, cancelOrder, getBatch, getOrder, supportedCouriers } from "./controllers/orderController";

const router = Router();
function validateBody(schema: typeof orderSchema | typeof bulkSchema) {
  return (req: any, _res: any, next: any) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return next(result.error);
    req.body = result.data;
    next();
  };
}
router.get("/couriers", supportedCouriers);
router.post("/orders", validateBody(orderSchema), createOrder);
router.post("/orders/bulk", validateBody(bulkSchema), createBulk);
router.get("/orders/:orderId", getOrder);
router.get("/orders/:orderId/track", trackOrder);
router.post("/orders/:orderId/cancel", cancelOrder);
router.get("/batches/:batchId", getBatch);
export default router;
