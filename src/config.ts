import dotenv from "dotenv";
dotenv.config();

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: numberFromEnv("PORT", 3000),
  logLevel: process.env.LOG_LEVEL ?? "info",
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(",").map(origin => origin.trim()).filter(Boolean),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5433/courier_platform",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  queueName: process.env.QUEUE_NAME ?? "courier-orders",
  bulkConcurrency: numberFromEnv("BULK_CONCURRENCY", 10),
  courierTimeoutMs: numberFromEnv("COURIER_TIMEOUT_MS", 10000),
  courierMaxRetries: numberFromEnv("COURIER_MAX_RETRIES", 3),
  courierRetryBaseDelayMs: numberFromEnv("COURIER_RETRY_BASE_DELAY_MS", 500),
  urbaneBolt: {
    baseUrl: process.env.URBANEBOLT_BASE_URL ?? "https://uat.urbanebolt.in",
    username: process.env.URBANEBOLT_USERNAME ?? "",
    password: process.env.URBANEBOLT_PASSWORD ?? "",
    cookie: process.env.URBANEBOLT_COOKIE ?? "",
    customerCode: process.env.URBANEBOLT_CUSTOMER_CODE ?? "",
    serviceType: process.env.URBANEBOLT_SERVICE_TYPE ?? "SDD",
    authPath: process.env.URBANEBOLT_AUTH_PATH ?? "/api/v1/auth/getToken/",
    createOrderPath: process.env.URBANEBOLT_CREATE_ORDER_PATH ?? "/api/v1/services/manifest/",
    trackPath: process.env.URBANEBOLT_TRACK_PATH ?? "/api/v1/services/tracking-pub/?awb={awb}",
    cancelPath: process.env.URBANEBOLT_CANCEL_PATH ?? "/api/v1/services/cancel/"
  }
};
