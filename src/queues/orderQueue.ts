import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config";

export const redisConnection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
export const orderQueue = new Queue(config.queueName, { connection: redisConnection });
export async function enqueueOrder(orderPk: string, requestId?: string) {
  await orderQueue.add("create-shipment", { orderPk, requestId }, {
    attempts: config.courierMaxRetries,
    backoff: { type: "exponential", delay: config.courierRetryBaseDelayMs },
    removeOnComplete: 1000,
    removeOnFail: 5000,
    jobId: orderPk
  });
}
