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
    REQAML_MODE: z.enum(["development", "production"]).default("development"),
    REQAML_ROLES: z
      .string()
      .default("api,web,mcp,sync")
      .transform((s) =>
        s
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean)
          .map((r) => RoleSchema.parse(r)),
      ),
    REQAML_PORT: z.coerce.number().default(3000),
    REQAML_MCP_PORT: z.coerce.number().default(3001),
    REQAML_VERSION: z.string().default("0.1.0-dev"),
    DATABASE_URL: z.string().min(1),
    OPENBAO_ADDR: z.string().url().optional(),
    OPENBAO_TOKEN: z.string().optional(),
    OPENBAO_TOKEN_FILE: z.string().optional(),
    REQAML_OPENBAO_DEV_MARKED: envFlag,
    REQAML_SEED_ON_START: envFlag,
    REQAML_SEED_PATH: z.string().default("docs/design/seed/dogfood.yaml"),
    // Empty (e.g. `REQAML_DEV_ACCOUNT_PASSWORD=` from .env.example) means "not set".
    REQAML_DEV_ACCOUNT_PASSWORD: z.preprocess(emptyToUndefined, z.string().optional()),
    REQAML_READY_CACHE_MS: z.coerce.number().default(2_000),
    REQAML_READY_PROBE_TIMEOUT_MS: z.coerce.number().default(3_000),
    REQAML_STARTUP_MAX_WAIT_MS: z.coerce.number().default(120_000),
    REQAML_STARTUP_INITIAL_DELAY_MS: z.coerce.number().default(1_000),
    REQAML_ISSUER_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    REQAML_TRUST_PROXY: envFlag,
    REQAML_SESSION_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
    REQAML_AGENT_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
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
  return config.REQAML_MODE === "production";
}
