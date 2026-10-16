import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

let pool: pg.Pool | undefined;
let database: ReturnType<typeof drizzle<typeof schema>> | undefined;

/** Hospital data has one explicit target; never substitute the default store. */
export function getHospitalPool() {
  if (pool) return pool;
  const connectionString = process.env.RAILWAY_DATABASE_URL;
  if (!connectionString) {
    throw new Error("RAILWAY_DATABASE_URL must be configured for hospital administration");
  }
  pool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
  return pool;
}

export function getHospitalsDb() {
  if (!database) database = drizzle(getHospitalPool(), { schema });
  return database;
}

// Lazy facades let existing routes and maintenance scripts keep their query
// logic while resolving the Railway-only connection inside request error handling.
// Binding methods is important for Drizzle/pg methods that access `this`.
export const hospitalDb = new Proxy({} as ReturnType<typeof getHospitalsDb>, {
  get(_target, key) {
    const db = getHospitalsDb();
    const value = Reflect.get(db, key);
    return typeof value === "function" ? value.bind(db) : value;
  },
});

export const hospitalPool = new Proxy({} as pg.Pool, {
  get(_target, key) {
    const pool = getHospitalPool();
    const value = Reflect.get(pool, key);
    return typeof value === "function" ? value.bind(pool) : value;
  },
});
