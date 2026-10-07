import { exportJWK, generateKeyPair, importJWK, SignJWT, type JWK } from "jose";
import type pg from "pg";
import type { KeyProvider } from "./provider.js";

const ROTATION_OVERLAP_MS = 7 * 24 * 60 * 60 * 1000;

export type SigningKeyRow = {
  kid: string;
  alg: string;
  public_jwk: JWK;
  private_key_ciphertext: string;
  status: string;
  not_before: Date;
  not_after: Date | null;
};

export async function ensureSigningKeys(
  pool: pg.Pool,
  keyProvider: KeyProvider,
): Promise<void> {
  await keyProvider.ensureReady();
  const r = await pool.query(`SELECT kid FROM signing_keys WHERE status = 'active'`);
  if (r.rowCount && r.rowCount > 0) return;

  await createSigningKey(pool, keyProvider);
}

async function createSigningKey(
  pool: pg.Pool,
  keyProvider: KeyProvider,
): Promise<string> {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const pubJwk = await exportJWK(publicKey);
  const privJwk = await exportJWK(privateKey);
  const kid = `reqaml-${Date.now()}`;
  pubJwk.kid = kid;
  privJwk.kid = kid;
  const wrapped = await keyProvider.wrapSecret(
    Buffer.from(JSON.stringify(privJwk), "utf8"),
    "signing",
  );
  await pool.query(
    `
    INSERT INTO signing_keys (kid, alg, public_jwk, private_key_ciphertext, status)
    VALUES ($1, 'ES256', $2::jsonb, $3, 'active')
  `,
    [kid, JSON.stringify(pubJwk), wrapped],
  );
  return kid;
}

export async function getActiveSigningKey(
  pool: pg.Pool,
  keyProvider: KeyProvider,
): Promise<{ kid: string; privateKey: CryptoKey; publicJwk: JWK }> {
  const r = await pool.query<SigningKeyRow>(
    `
    SELECT kid, alg, public_jwk, private_key_ciphertext, status, not_before, not_after
    FROM signing_keys
    WHERE status = 'active'
    ORDER BY created_at DESC
    LIMIT 1
  `,
  );
  if (!r.rowCount) {
    await ensureSigningKeys(pool, keyProvider);
    return getActiveSigningKey(pool, keyProvider);
  }
  const row = r.rows[0];
  const privPlain = await keyProvider.unwrapSecret(
    row.private_key_ciphertext,
    "signing",
  );
  const privJwk = JSON.parse(privPlain.toString("utf8")) as JWK;
  const privateKey = (await importJWK(privJwk, row.alg)) as CryptoKey;
  return { kid: row.kid, privateKey, publicJwk: row.public_jwk as JWK };
}

export async function getPublicJwks(pool: pg.Pool): Promise<{ keys: JWK[] }> {
  const now = Date.now();
  const r = await pool.query<SigningKeyRow>(
    `SELECT kid, alg, public_jwk, not_before, not_after, status FROM signing_keys ORDER BY created_at DESC`,
  );
  const keys: JWK[] = [];
  for (const row of r.rows) {
    const nb = row.not_before.getTime();
    const na = row.not_after?.getTime() ?? now + ROTATION_OVERLAP_MS;
    if (row.status === "active" || (row.status === "retired" && now < na)) {
      if (now >= nb) {
        keys.push(row.public_jwk as JWK);
      }
    }
  }
  return { keys };
}

export async function rotateSigningKey(
  pool: pg.Pool,
  keyProvider: KeyProvider,
): Promise<string> {
  const overlapEnd = new Date(Date.now() + ROTATION_OVERLAP_MS);
  await pool.query(
    `
    UPDATE signing_keys
    SET status = 'retired', not_after = $1
    WHERE status = 'active'
  `,
    [overlapEnd],
  );
  return createSigningKey(pool, keyProvider);
}

export async function signAccessToken(
  pool: pg.Pool,
  keyProvider: KeyProvider,
  claims: {
    sub: string;
    aud: string;
    iss: string;
    clientId: string;
    scope?: string;
    authTime: number;
    mfa?: boolean;
  },
  ttlSeconds: number,
): Promise<{ token: string; jti: string }> {
  const { kid, privateKey } = await getActiveSigningKey(pool, keyProvider);
  const jti = crypto.randomUUID();
  const token = await new SignJWT({
    aud: claims.aud,
    client_id: claims.clientId,
    scope: claims.scope,
    auth_time: claims.authTime,
    amr: claims.mfa ? ["pwd", "mfa"] : ["pwd"],
  })
    .setProtectedHeader({ alg: "ES256", kid })
    .setIssuer(claims.iss)
    .setSubject(claims.sub)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(privateKey);
  return { token, jti };
}
