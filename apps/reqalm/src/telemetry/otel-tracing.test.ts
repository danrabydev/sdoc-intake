import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";
import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { bindOperationLogCapture } from "../core/logging/structured-log.js";
import { buildRequestContext } from "../core/request-context.js";
import { createOpenBaoKeyProvider } from "../key/provider.js";
import { loadConfig } from "../config.js";
import {
  createTestApp,
  pkcePair,
  TEST_API_RESOURCE,
  TEST_AGENT_SECRET,
  TEST_ISSUER,
  TEST_PASSWORD,
  type TestApp,
} from "../test/harness.js";
import { normalizeRequestId } from "./request-id.js";
import { traceLogFields } from "./trace-context.js";
import { REDACTED_SERVER_QUERY_PARAMS } from "./instrumentations.js";
import { finishedSpans, resetTelemetrySpans } from "../test/otel-testing.js";

function spanByNameIncludes(needle: string) {
  return finishedSpans().find((s) => s.name.includes(needle) || s.name === needle);
}

function operationSpan(name: string) {
  return finishedSpans().find((s) => s.name === `operation ${name}`);
}

function pgSpanParentId(span: ReturnType<typeof finishedSpans>[number]) {
  return span.parentSpanContext?.spanId;
}

function pgSpanChildOf(parentSpanId: string) {
  return finishedSpans().find(
    (s) =>
      pgSpanParentId(s) === parentSpanId &&
      (s.name.startsWith("pg.query") ||
        s.attributes["db.system"] === "postgresql" ||
        s.attributes["db.system.name"] === "postgresql"),
  );
}

describe("OpenTelemetry tracing", () => {
  let ctx: TestApp;

  before(async () => {
    ctx = await createTestApp();
  });

  const opLogCapture: import("../core/logging/structured-log.js").OperationLogFields[] = [];

  beforeEach(() => {
    resetTelemetrySpans();
    opLogCapture.length = 0;
    bindOperationLogCapture(opLogCapture);
  });

  after(async () => {
    bindOperationLogCapture(null);
    await ctx.close();
  });

  async function inject(opts: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    payload?: string | object;
  }) {
    return ctx.app.inject({
      ...opts,
      remoteAddress: "203.0.113.50",
      headers: { host: "localhost:3000", ...opts.headers },
    } as never);
  }

  async function loginToken(): Promise<string> {
    const { verifier, challenge } = pkcePair();
    const redirectUri = `${TEST_ISSUER}/oauth/callback`;
    const authz = await inject({
      method: "GET",
      url: `/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: "reqalm-web",
        redirect_uri: redirectUri,
        scope: "openid profile",
        state: "s",
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: TEST_API_RESOURCE,
      })}`,
    });
    const loc = String(authz.headers.location ?? "");
    const handoff = new URL(loc, TEST_ISSUER).searchParams.get("h");
    assert.ok(handoff);
    const login = await inject({
      method: "POST",
      url: "/api/v1/auth/local/login",
      headers: { "content-type": "application/json" },
      payload: { username: "casey-reader@dev.local", password: TEST_PASSWORD, h: handoff },
    });
    const body = login.json() as { redirect: string };
    const code = new URL(body.redirect, TEST_ISSUER).searchParams.get("code");
    assert.ok(code);
    const token = await inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: "reqalm-web",
        redirect_uri: redirectUri,
        code_verifier: verifier,
        resource: TEST_API_RESOURCE,
      }).toString(),
    });
    return (token.json() as { access_token: string }).access_token;
  }

  it("GET /api/v1/projects/:id yields HTTP > operation > pg.query span tree", async () => {
    const access = await loginToken();
    resetTelemetrySpans();
    const res = await inject({
      method: "GET",
      url: "/api/v1/projects/reqalm",
      headers: { authorization: `Bearer ${access}`, "x-request-id": "trace-tree-req" },
    });
    assert.equal(res.statusCode, 200);

    const opSpan = operationSpan("projects.get");
    assert.ok(opSpan, "expected operation span");
    const pgUnderOp = pgSpanChildOf(opSpan!.spanContext().spanId);
    assert.ok(pgUnderOp, "expected pg instrumentation span child of operation span");
    const dbSystem =
      pgUnderOp!.attributes["db.system.name"] ?? pgUnderOp!.attributes["db.system"];
    assert.equal(dbSystem, "postgresql");

    const opParent = finishedSpans().find((s) => pgSpanParentId(opSpan!) === s.spanContext().spanId);
    assert.ok(opParent, "operation span should nest under Fastify HTTP instrumentation");
    assert.ok(
      opParent!.name === "request" || opParent!.name.startsWith("handler"),
      `unexpected operation parent: ${opParent!.name}`,
    );
    assert.ok(finishedSpans().some((s) => s.name === "request"), "expected top-level request span");
  });

  it("KeyProvider OpenBao calls emit dependency spans under the active span", async () => {
    let server: Server | null = null;
    try {
      server = createServer((req, res) => {
        if (req.url?.includes("/v1/transit/encrypt/")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ data: { ciphertext: "vault:v1:fake" } }));
          return;
        }
        res.writeHead(404);
        res.end();
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      const addr = server.address();
      assert.ok(addr && typeof addr === "object");
      const config = loadConfig({
        ...process.env,
        REQALM_MODE: "development",
        DATABASE_URL: "postgres://unused/local",
        OPENBAO_ADDR: `http://127.0.0.1:${addr.port}`,
        OPENBAO_TOKEN: "test-token-should-not-appear-in-spans",
      });
      resetTelemetrySpans();
      const provider = createOpenBaoKeyProvider(config);
      await provider.wrapSecret(Buffer.from("hello"), "test-purpose");
      const keySpan = spanByNameIncludes("key.wrapSecret");
      assert.ok(keySpan, "expected KeyProvider span");
      assert.equal(keySpan!.attributes["dependency.name"], "openbao");
      assert.equal(keySpan!.attributes["key.purpose"], "test-purpose");
      // The OpenBao HTTP call itself comes from the standard undici instrumentation, as a child.
      const httpSpan = finishedSpans().find(
        (s) =>
          s.parentSpanContext?.spanId === keySpan!.spanContext().spanId &&
          String(s.attributes["url.path"] ?? "").includes("/v1/transit/encrypt/"),
      );
      assert.ok(httpSpan, "expected undici HTTP span under the KeyProvider span");
      const serialized = JSON.stringify(finishedSpans().map((s) => s.attributes));
      assert.ok(!serialized.includes("test-token"), "token must not appear in span attributes");
      assert.ok(!serialized.toLowerCase().includes("x-vault-token"));
      assert.ok(!serialized.includes("aGVsbG8"), "plaintext must not appear in span attributes");
      assert.ok(!serialized.includes(TEST_AGENT_SECRET));
    } finally {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
  });

  it("audit row and operation log share trace_id", async () => {
    const access = await loginToken();
    resetTelemetrySpans();
    const res = await inject({
      method: "GET",
      url: "/api/v1/projects/reqalm",
      headers: { authorization: `Bearer ${access}`, "x-request-id": "audit-trace-req" },
    });
    assert.equal(res.statusCode, 200);
    const opSpan = operationSpan("projects.get");
    assert.ok(opSpan);
    const traceId = opSpan!.spanContext().traceId;

    const audit = await ctx.pool.query<{ trace_id: string | null }>(
      `SELECT trace_id FROM audit_events WHERE request_id = $1 ORDER BY id DESC LIMIT 1`,
      ["audit-trace-req"],
    );
    assert.equal(audit.rows[0]?.trace_id, traceId);

    const opLog = opLogCapture.find((entry) => entry.operation === "projects.get");
    assert.ok(opLog?.traceId);
    assert.equal(opLog.traceId, traceId);
  });

  it("continues an incoming W3C traceparent", async () => {
    const access = await loginToken();
    const upstreamTrace = "4bf92f3577b34da6a3ce929d0e0e4736";
    const upstreamSpan = "00f067aa0ba902b7";
    resetTelemetrySpans();
    await inject({
      method: "GET",
      url: "/api/v1/projects/reqalm",
      headers: {
        authorization: `Bearer ${access}`,
        traceparent: `00-${upstreamTrace}-${upstreamSpan}-01`,
      },
    });
    const opSpan = operationSpan("projects.get");
    assert.ok(opSpan);
    assert.equal(opSpan!.spanContext().traceId, upstreamTrace);
  });

  it("replaces invalid x-request-id", () => {
    const bad = "has spaces and is way too long for the printable rule " + "x".repeat(200);
    const normalized = normalizeRequestId(bad);
    assert.match(normalized, /^[0-9a-f-]{36}$/i);
  });

  it("uses validated x-request-id on responses", async () => {
    const access = await loginToken();
    const res = await inject({
      method: "GET",
      url: "/api/v1/projects/reqalm",
      headers: { authorization: `Bearer ${access}`, "x-request-id": "valid-req-id-42" },
    });
    const body = res.json() as { request_id: string };
    assert.equal(body.request_id, "valid-req-id-42");
    const badRes = await inject({
      method: "GET",
      url: "/api/v1/projects/reqalm",
      headers: { authorization: `Bearer ${access}`, "x-request-id": "bad id\n" },
    });
    const badBody = badRes.json() as { request_id: string };
    assert.notEqual(badBody.request_id, "bad id\n");
    assert.match(badBody.request_id, /^[0-9a-f-]{36}$/i);
  });

  it("operation spans mark deny without leaking bearer tokens in attributes", async () => {
    resetTelemetrySpans();
    await inject({
      method: "GET",
      url: "/api/v1/projects/reqalm",
      headers: {
        authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret.payload",
        "x-request-id": "deny-span-req",
      },
    });
    const opSpan = operationSpan("projects.get");
    assert.ok(opSpan);
    assert.equal(opSpan!.attributes["reqalm.outcome"], "deny");
    assert.equal(opSpan!.status.code, SpanStatusCode.ERROR);
    const blob = JSON.stringify(opSpan!.attributes);
    assert.ok(!blob.includes("eyJhbGci"));
    assert.ok(!blob.toLowerCase().includes("password"));
  });
  it("RequestContext reuses Fastify's request id, so logs, audit and response agree", async () => {
    const rc = await buildRequestContext(
      { id: "fastify-req-id", headers: { "x-request-id": "bad id" }, ip: "127.0.0.1" } as never,
      { pool: ctx.pool, config: ctx.config, keyProvider: ctx.keyProvider, logger: ctx.app.log },
    );
    assert.equal(rc.requestId, "fastify-req-id");
  });

  it("missing or invalid x-request-id yields one generated id across response and audit", async () => {
    const variants: Record<string, string>[] = [{}, { "x-request-id": "x".repeat(129) }];
    for (const headers of variants) {
      const res = await inject({ method: "GET", url: "/api/v1/projects/reqalm", headers });
      const body = res.json() as { request_id: string };
      assert.match(body.request_id, /^[0-9a-f-]{36}$/i);
      const audit = await ctx.pool.query(`SELECT 1 FROM audit_events WHERE request_id = $1`, [
        body.request_id,
      ]);
      assert.equal(audit.rowCount, 1);
    }
  });

  it("log mixin adds trace_id/span_id only while a span is active", () => {
    // Wired into the app logger (pino keeps it under a private symbol).
    let mixin: unknown;
    for (let o: object | null = ctx.app.log; o && !mixin; o = Object.getPrototypeOf(o)) {
      const sym = Object.getOwnPropertySymbols(o).find((x) => x.description === "pino.mixin");
      if (sym) mixin = (o as Record<symbol, unknown>)[sym];
    }
    assert.equal(mixin, traceLogFields, "app logger must use the trace mixin");
    assert.deepEqual(traceLogFields(), {});
    trace.getTracer("t").startActiveSpan("log-mixin", (span) => {
      const fields = traceLogFields();
      assert.equal(fields.trace_id, span.spanContext().traceId);
      assert.equal(fields.span_id, span.spanContext().spanId);
      span.end();
    });
  });

  it("real HTTP: server span parents Fastify, and the OAuth code is redacted from url.query", async () => {
    const address = await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    resetTelemetrySpans();
    await fetch(`${address}/oauth/web/callback?code=SECRETCODE123&state=st`, { redirect: "manual" });
    const server = finishedSpans().find(
      (s) => s.kind === SpanKind.SERVER && s.attributes["url.path"] === "/oauth/web/callback",
    );
    assert.ok(server, "expected http server span");
    assert.ok(!String(server!.attributes["url.query"]).includes("SECRETCODE123"));
    // Only the test's own outgoing fetch (undici client span) may carry the URL it requested.
    const appSpans = finishedSpans().filter((s) => s.kind !== SpanKind.CLIENT);
    assert.ok(!JSON.stringify(appSpans.map((s) => s.attributes)).includes("SECRETCODE123"));
    const fastifyRequest = finishedSpans().find(
      (s) => s.name === "request" && s.parentSpanContext?.spanId === server!.spanContext().spanId,
    );
    assert.ok(fastifyRequest, "Fastify request span should be a child of the http server span");
    assert.ok(REDACTED_SERVER_QUERY_PARAMS.includes("code"));
  });

  it("probe routes are not traced", async () => {
    resetTelemetrySpans();
    const address = ctx.app.server.address();
    assert.ok(address && typeof address === "object");
    await fetch(`http://127.0.0.1:${address.port}/health`);
    const appSpans = finishedSpans().filter((s) => s.kind !== SpanKind.CLIENT);
    assert.deepEqual(
      appSpans.map((s) => s.name),
      [],
      "health probe must not create http or Fastify spans",
    );
  });
});
