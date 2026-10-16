import { Worker, Job } from "bullmq";
import { config } from "./config";
import { enqueueOrder, redisConnection } from "./queues/orderQueue";
import { pool } from "./db/pool";
import { courierRegistry } from "./couriers";
import { orderRepository } from "./services/orderRepository";
import { NormalizedOrder } from "./types/courier";
import { logger } from "./logger";
import { AppError } from "./errors/AppError";

const worker = new Worker(config.queueName, async (job: Job<{ orderPk: string; requestId?: string }>) => {
  const found = await pool.query("SELECT * FROM orders WHERE id=$1", [job.data.orderPk]);
  const row = found.rows[0];
  if (row?.status !== "PENDING") return;
  const order = row.request_payload as NormalizedOrder;
  const requestId = job.data.requestId ?? row.request_id;
  try {
    const adapter = courierRegistry.get(row.courier_partner);
    const result = await adapter.createShipment(order);
    await orderRepository.markCreated(row.id, result, result.status);
  } catch (error) {
    const appError = error instanceof AppError ? error : new AppError(502, "COURIER_ERROR", "Courier shipment creation failed", undefined, true);
    const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    logger.error({ orderId: row.order_id, courierPartner: row.courier_partner, requestId, attempt: job.attemptsMade + 1, err: error }, "Bulk order processing failed");
    if (!appError.retryable || lastAttempt) {
      await orderRepository.markFailure(row.id, appError.code, appError.message, appError.internalContext);
      if (!appError.retryable) return;
    }
    throw error;
  }
}, { connection: redisConnection, concurrency: config.bulkConcurrency });

worker.on("completed", job => logger.info({ jobId: job.id }, "Bulk order job completed"));
worker.on("failed", (job, err) => logger.error({ jobId: job?.id, err }, "Bulk order job failed"));

let dispatching = false;
async function dispatchOutbox() {
  if (dispatching) return;
  dispatching = true;
  try {
    const entries = await orderRepository.pendingOutbox();
    await Promise.all(entries.map(async entry => {
      try {
        await enqueueOrder(entry.order_pk, entry.request_id);
        await orderRepository.markOutboxDispatched(entry.order_pk);
      } catch (error) {
        logger.error({ orderPk: entry.order_pk, requestId: entry.request_id, err: error }, "Outbox dispatch failed; will retry");
      }
    }));
  } catch (error) {
    logger.error({ err: error }, "Could not read order outbox");
  } finally {
    dispatching = false;
  }
}
void dispatchOutbox();
const outboxTimer = setInterval(() => void dispatchOutbox(), 1000);

async function shutdown() { clearInterval(outboxTimer); await worker.close(); await redisConnection.quit(); await pool.end(); process.exit(0); }
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
