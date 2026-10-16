import fs from "node:fs";
import path from "node:path";
import { pool } from "./pool";

async function main() {
  const sql = fs.readFileSync(path.resolve(process.cwd(), "migrations/001_init.sql"), "utf8");
  await pool.query(sql);
  console.log("Database migration applied");
  await pool.end();
}
main().catch(async error => { console.error(error); await pool.end(); process.exit(1); });
