import { Pool } from "pg";
import { config } from "../config";
export const pool = new Pool({ connectionString: config.databaseUrl, max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
pool.on("error", err => console.error("Unexpected PostgreSQL pool error", err));
