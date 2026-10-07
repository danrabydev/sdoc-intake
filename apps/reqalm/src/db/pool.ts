import pg from "pg";

let pool: pg.Pool | null = null;

export function getPool(databaseUrl: string): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: databaseUrl,
      max: 10,
      // Fail fast instead of hanging when Postgres is down (readiness / startup backoff retry).
      connectionTimeoutMillis: 3_000,
    });
    pool.on("error", (err) => {
      console.warn(`[db] idle client error: ${err.message}`);
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function pingDatabase(databaseUrl: string): Promise<boolean> {
  const client = await getPool(databaseUrl).connect();
  try {
    await client.query("SELECT 1");
    return true;
  } finally {
    client.release();
  }
}
