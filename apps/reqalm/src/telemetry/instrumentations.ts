/**
 * The one instrumentation list for both production (`register.ts`) and the in-process test SDK
 * (`src/test/otel-testing.ts`), so tests exercise exactly what production exports.
 */
import type { IncomingMessage } from "node:http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { getFastifyOtelInstrumentation } from "./fastify-otel.js";

/**
 * Query params redacted on server spans. Keeps parity with the Fastify log serializer, which
 * redacts the OAuth `code` on `/oauth/web/callback`; the rest are the instrumentation's defaults
 * plus other OAuth credentials that must never sit in a URL.
 */
export const REDACTED_SERVER_QUERY_PARAMS = [
  "sig",
  "Signature",
  "AWSAccessKeyId",
  "X-Goog-Signature",
  "X-Amz-Signature",
  "X-Amz-Credential",
  "X-Amz-Security-Token",
  "code",
  "access_token",
  "refresh_token",
  "id_token",
  "client_secret",
];

/**
 * Orchestrator probes (healthcheck every 10s); tracing them only adds noise. Ignoring them here
 * suppresses tracing for the whole request, so Fastify and pg spans are not created either.
 */
const UNTRACED_PATHS = new Set(["/health", "/ready"]);

function isUntracedProbe(req: IncomingMessage): boolean {
  const path = (req.url ?? "").split("?")[0] ?? "";
  return UNTRACED_PATHS.has(path);
}

export function createInstrumentations() {
  return [
    new HttpInstrumentation({
      ignoreIncomingRequestHook: isUntracedProbe,
      redactedQueryParamsServer: REDACTED_SERVER_QUERY_PARAMS,
    }),
    new UndiciInstrumentation(),
    // requireParentSpan: queries outside a request/operation (migrations, the startup seed: ~500
    // INSERTs per boot) would otherwise each export as their own single-span trace.
    new PgInstrumentation({ enhancedDatabaseReporting: false, requireParentSpan: true }),
    getFastifyOtelInstrumentation() as never,
  ];
}
