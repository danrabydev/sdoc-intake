import { trace, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { KeyProvider } from "../key/provider.js";

const TRACER_NAME = "reqalm.openbao";

/**
 * Wraps a KeyProvider so each call is one span (`key.wrapSecret` etc.). The HTTP calls to OpenBao
 * underneath are traced by the standard undici instrumentation as children of this span; no
 * plaintext, ciphertext or token is ever put on a span, only the dependency name and purpose.
 */
export function traceKeyProvider(inner: KeyProvider, dependencyName = "openbao"): KeyProvider {
  const tracer = trace.getTracer(TRACER_NAME);
  const traced = <T>(name: string, purpose: string | null, fn: () => Promise<T>): Promise<T> =>
    tracer.startActiveSpan(
      name,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "dependency.name": dependencyName,
          ...(purpose ? { "key.purpose": purpose } : {}),
        },
      },
      async (span) => {
        try {
          return await fn();
        } catch (err) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err instanceof Error ? err.message : String(err),
          });
          throw err;
        } finally {
          span.end();
        }
      },
    );
  return {
    ensureReady: () => traced("key.ensureReady", null, () => inner.ensureReady()),
    wrapSecret: (plaintext, purpose) =>
      traced("key.wrapSecret", purpose, () => inner.wrapSecret(plaintext, purpose)),
    unwrapSecret: (ciphertext, purpose) =>
      traced("key.unwrapSecret", purpose, () => inner.unwrapSecret(ciphertext, purpose)),
  };
}
