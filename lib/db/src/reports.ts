import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

function createReportsDatabase(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
  return drizzle(pool, { schema });
}

let reportsDatabase: ReturnType<typeof createReportsDatabase> | undefined;

/**
 * Reports share the Android app's existing Railway database. Do not fall back
 * to DATABASE_URL: the published web API's default database is a different store.
 * Other hospital data continues to use the default database.
 */
export function getReportsDb() {
  if (reportsDatabase) return reportsDatabase;

  const connectionString = process.env.RAILWAY_DATABASE_URL;
  if (!connectionString) {
    throw new Error("RAILWAY_DATABASE_URL must be configured for hospital reports");
  }

  reportsDatabase = createReportsDatabase(connectionString);
  return reportsDatabase;
}
