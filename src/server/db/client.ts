import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

let _db: ReturnType<typeof drizzle> | null = null;
let _client: ReturnType<typeof postgres> | null = null;

export function getDb() {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  // We keep the pool small; Fastify is single-process. postgres.js
  // is already happy to multiplex on a single connection.
  _client = postgres(url, { max: 10, prepare: false });
  _db = drizzle(_client, { schema });
  return _db;
}

export function getClient() {
  if (!_client) getDb();
  return _client!;
}

export async function closeDb(): Promise<void> {
  if (_client) {
    await _client.end({ timeout: 5 });
    _client = null;
    _db = null;
  }
}

export { schema };
