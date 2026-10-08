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
