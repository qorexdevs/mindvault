import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config.js";
import * as schema from "./schema.js";

const client = postgres(config.DATABASE_URL);

export let db = drizzle(client, { schema });

// test seam: integration tests swap in an in-memory pglite db so the db-backed
// queries run for real without a live postgres. never called in production.
export function __setTestDb(instance: typeof db) {
  db = instance;
}
