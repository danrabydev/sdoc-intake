import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { ok } from "../core/service-result.js";
import { createTestApp, type TestApp } from "../test/harness.js";
import { requestIdFromHeaders } from "../telemetry/request-id.js";
import { defineOperationRoute, parseZodInput } from "./define-operation-route.js";

let ctx: TestApp;
let app: FastifyInstance;

const echoOp = {
  name: "test.echo",
  authenticatedOnly: true as const,
  execute: async () => ok({ echoed: true }),
};

before(async () => {
  ctx = await createTestApp();
  app = Fastify({ genReqId: (req) => requestIdFromHeaders(req.headers) });
  const deps = { pool: ctx.pool, config: ctx.config, keyProvider: ctx.keyProvider, logger: app.log };
  defineOperationRoute(app, deps, {
    method: "post",
    url: "/api/v1/test/echo",
    op: echoOp,
    parseInput: (req) => parseZodInput(z.object({ n: z.number() }), req.body, "body"),
  });
  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/test/boom",
    op: echoOp,
    parseInput: () => {
      throw new Error("boom: db password=hunter2");
    },
  });
  await app.ready();
});

after(async () => {
  await app.close();
  await ctx.close();
});

function assertProblem(
  res: { statusCode: number; headers: Record<string, unknown>; json(): unknown },
  status: number,
  code: string,
  requestId: string,
): Record<string, unknown> {
  assert.equal(res.statusCode, status);
  assert.match(String(res.headers["content-type"]), /^application\/problem\+json/);
  const body = res.json() as Record<string, unknown>;
  assert.equal(body.status, status);
  assert.equal(body.code, code);
  assert.equal(body.request_id, requestId);
  return body;
}

describe("defineOperationRoute errors are Problem Details", () => {
  it("malformed JSON body: 400 problem+json with the request id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/test/echo",
      headers: { "content-type": "application/json", "x-request-id": "bad-json-1" },
      payload: "{",
    });
    const body = assertProblem(res, 400, "validation", "bad-json-1");
    assert.deepEqual(body.details, { reason: "FST_ERR_CTP_INVALID_JSON_BODY" });
  });

  it("unsupported media type keeps 415 as problem+json", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/test/echo",
      headers: { "content-type": "application/xml", "x-request-id": "bad-ctype-1" },
      payload: "<x/>",
    });
    assertProblem(res, 415, "validation", "bad-ctype-1");
  });

  it("an unexpected throw is a 500 problem without the error message", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/test/boom",
      headers: { "x-request-id": "boom-1" },
    });
    const body = assertProblem(res, 500, "internal", "boom-1");
    assert.equal(body.detail, "Internal error");
    assert.doesNotMatch(res.body, /hunter2|boom:/);
  });
});

describe("defineOperationRoute registration", () => {
  const exec = async () => ok({});
  const scoped = { projectScoped: true, projectIdFromInput: (i: { projectId: string }) => i.projectId };
  function register(op: unknown, parseInput: unknown = () => ok({ projectId: "reqalm" })) {
    const local = Fastify();
    const deps = { pool: ctx.pool, config: ctx.config, keyProvider: ctx.keyProvider, logger: local.log };
    const url = "/api/v1/test/bind";
    let error: unknown;
    try {
      defineOperationRoute(local, deps, { method: "get", url, op: op as never, parseInput: parseInput as never });
    } catch (e) {
      error = e;
    }
    const registered = local.hasRoute({ method: "GET", url });
    return { error: error instanceof Error ? error.message : undefined, registered };
  }
  function assertRefused(op: unknown, why: RegExp, parseInput?: unknown) {
    const r = register(op, parseInput);
    assert.match(r.error ?? "(no error)", why);
    assert.equal(r.registered, false, "nothing is registered");
  }

  it("throws when the operation is missing", () => {
    assertRefused(undefined, /missing operation/);
  });

  it("throws when the operation has no execute", () => {
    assertRefused({ name: "x.y", authenticatedOnly: true }, /missing operation/);
  });

  it("throws when parseInput is missing", () => {
    assertRefused({ name: "x.y", authenticatedOnly: true, execute: exec }, /missing parseInput/, null);
  });

  it("throws when neither a permission nor authenticatedOnly is declared", () => {
    assertRefused({ name: "x.y", execute: exec }, /missing permission/);
  });

  it("throws on an empty permission", () => {
    assertRefused({ name: "x.y", permission: "", execute: exec, ...scoped }, /missing permission|non-empty/);
  });

  it("throws on a non-string permission", () => {
    assertRefused({ name: "x.y", permission: true, execute: exec, ...scoped }, /non-empty string/);
  });

  it("throws when permission and authenticatedOnly are both set", () => {
    assertRefused(
      { name: "x.y", permission: "requirement:read", authenticatedOnly: true, execute: exec, ...scoped },
      /exclusive/,
    );
  });

  it("throws on a permission without project scope (no cross-project authorization)", () => {
    assertRefused({ name: "x.y", permission: "requirement:read", execute: exec }, /without project scope/);
  });

  it("throws on projectScoped without projectIdFromInput", () => {
    assertRefused(
      { name: "x.y", permission: "requirement:read", projectScoped: true, execute: exec },
      /projectScoped without projectIdFromInput/,
    );
  });

  it("registers a fully bound operation", () => {
    assert.deepEqual(register({ name: "x.y", permission: "requirement:read", execute: exec, ...scoped }), {
      error: undefined,
      registered: true,
    });
    assert.deepEqual(register({ name: "x.me", authenticatedOnly: true, execute: exec }), {
      error: undefined,
      registered: true,
    });
  });

  it("refuses Fastify input schemas (validation lives in parseInput only)", () => {
    const local = Fastify();
    const deps = { pool: ctx.pool, config: ctx.config, keyProvider: ctx.keyProvider, logger: local.log };
    assert.throws(
      () =>
        defineOperationRoute(local, deps, {
          method: "get",
          url: "/api/v1/test/schema",
          op: echoOp,
          parseInput: () => ok({}),
          schema: { params: { type: "object" } } as never,
        }),
      /validate params in parseInput/,
    );
  });
});
