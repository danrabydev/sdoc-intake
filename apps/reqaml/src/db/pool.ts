import pg from "pg";

let pool: pg.Pool | null = null;

export function getPool(databaseUrl: string): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
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
