import { app } from "./app";
import { config } from "./config";
import { logger } from "./logger";

const server = app.listen(config.port, () => logger.info({ port: config.port }, "Courier platform API started"));
async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
