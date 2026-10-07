import { readFileSync } from "node:fs";
import { z } from "zod";

const RoleSchema = z.enum(["api", "web", "mcp", "sync"]);

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

/** Boolean env flag: true/1 → true; false/0/empty/unset → false. */
const envFlag = z
  .preprocess(emptyToUndefined, z.enum(["true", "false", "1", "0"]).optional())
  .transform((v) => v === "true" || v === "1");

const EnvSchema = z
  .object({
    REQALM_MODE: z.enum(["development", "production"]).default("development"),
    REQALM_ROLES: z
      .string()
      .default("api,web,mcp,sync")
      .transform((s) =>
        s
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean)
          .map((r) => RoleSchema.parse(r)),
      ),
    REQALM_PORT: z.coerce.number().default(3000),
    REQALM_MCP_PORT: z.coerce.number().default(3001),
    REQALM_VERSION: z.string().default("0.1.0-dev"),
    DATABASE_URL: z.string().min(1),
    OPENBAO_ADDR: z.string().url().optional(),
    OPENBAO_TOKEN: z.string().optional(),
    OPENBAO_TOKEN_FILE: z.string().optional(),
    REQALM_OPENBAO_DEV_MARKED: envFlag,
    REQALM_SEED_ON_START: envFlag,
    REQALM_SEED_PATH: z.string().default("docs/design/seed/dogfood.yaml"),
    // Empty (e.g. `REQALM_DEV_ACCOUNT_PASSWORD=` from .env.example) means "not set".
    REQALM_DEV_ACCOUNT_PASSWORD: z.preprocess(emptyToUndefined, z.string().optional()),
    REQALM_READY_CACHE_MS: z.coerce.number().default(2_000),
    REQALM_READY_PROBE_TIMEOUT_MS: z.coerce.number().default(3_000),
    REQALM_STARTUP_MAX_WAIT_MS: z.coerce.number().default(120_000),
    REQALM_STARTUP_INITIAL_DELAY_MS: z.coerce.number().default(1_000),
    REQALM_ISSUER_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    REQALM_TRUST_PROXY: envFlag,
    // Comma-separated proxy IPs/CIDRs whose X-Forwarded-* headers are trusted (with REQALM_TRUST_PROXY).
    REQALM_TRUSTED_PROXIES: z.preprocess(emptyToUndefined, z.string().optional()),
    REQALM_SESSION_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
    REQALM_AGENT_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  })
  .transform((raw) => {
    let token = raw.OPENBAO_TOKEN;
    if (!token && raw.OPENBAO_TOKEN_FILE) {
      token = readFileSync(raw.OPENBAO_TOKEN_FILE, "utf8").trim();
    }
    return { ...raw, OPENBAO_TOKEN: token };
  });

export type AppRole = z.infer<typeof RoleSchema>;
export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return EnvSchema.parse(env);
}

export function isProduction(config: AppConfig): boolean {
  return config.REQALM_MODE === "production";
}
