import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { ok } from "../core/service-result.js";
import { createTestApp, issueTestAccessToken, type TestApp } from "../test/harness.js";
import { requestIdFromHeaders } from "../telemetry/request-id.js";
import { defineOperationRoute, parseZodInput, projectIdSchema } from "./define-operation-route.js";

let ctx: TestApp;
let app: FastifyInstance;
let bearer: Record<string, string>;
const seen = { parseInput: 0, execute: 0 };

const echoOp = {
  name: "test.echo",
  authenticatedOnly: true as const,
  execute: async () => ok({ echoed: true }),
};

type ItemInput = { projectId: string; title: string };
const itemOp = {
  name: "test.items.create",
  permission: "requirement:read",
  projectScoped: true,
  projectIdFromInput: (i: ItemInput) => i.projectId,
  execute: async (_ctx: unknown, i: ItemInput) => {
    seen.execute++;
    return ok({ created: i.title });
  },
};
const itemInput = z.object({ title: z.string().min(1) });

before(async () => {
  ctx = await createTestApp();
  bearer = { host: "localhost:3000", authorization: `Bearer ${await issueTestAccessToken(ctx.app)}` };
  await ctx.pool.query(
    `INSERT INTO projects (id, client_id, name) VALUES ('ungranted', 'reqalm-client', 'Ungranted') ON CONFLICT DO NOTHING`,
  );
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
  defineOperationRoute(app, deps, {
    method: "post",
    url: "/api/v1/test/projects/:projectId/items",
    op: itemOp,
    parseInput: (req) => {
      seen.parseInput++;
      const body = parseZodInput(itemInput, req.body, "body");
      if (!body.ok) return body;
      return ok({ projectId: (req.params as { projectId: string }).projectId, title: body.data.title });
    },
  });
  // A route whose parseInput names a different project than the path (a bug the pipeline must refuse).
  defineOperationRoute(app, deps, {
    method: "post",
    url: "/api/v1/test/projects/:projectId/misbound",
    op: itemOp,
    parseInput: (req) => ok({ projectId: String((req.body as { projectId?: unknown })?.projectId), title: "x" }),
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

async function auditRow(requestId: string) {
  const r = await ctx.pool.query<{ outcome: string; project_id: string | null; operation: string; detail: unknown }>(
    `SELECT outcome, project_id, operation, detail FROM audit_events WHERE request_id = $1`,
    [requestId],
  );
  assert.equal(r.rows.length, 1, `one audit row for ${requestId}`);
  return r.rows[0]!;
}

describe("defineOperationRoute errors are Problem Details", () => {
  it("malformed JSON body: 400 problem+json with the request id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/test/echo",
      headers: { ...bearer, "content-type": "application/json", "x-request-id": "bad-json-1" },
      payload: "{",
    });
    const body = assertProblem(res, 400, "validation", "bad-json-1");
    assert.deepEqual(body.details, { reason: "FST_ERR_CTP_INVALID_JSON_BODY" });
    assert.deepEqual((await auditRow("bad-json-1")).detail, { error_code: "validation" });
  });

  it("unsupported media type keeps 415 as problem+json", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/test/echo",
      headers: { ...bearer, "content-type": "application/xml", "x-request-id": "bad-ctype-1" },
      payload: "<x/>",
    });
    assertProblem(res, 415, "validation", "bad-ctype-1");
  });

  it("an unexpected throw is a 500 problem without the error message", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/test/boom",
      headers: { ...bearer, "x-request-id": "boom-1" },
    });
    const body = assertProblem(res, 500, "internal", "boom-1");
    assert.equal(body.detail, "Internal error");
    assert.doesNotMatch(res.body, /hunter2|boom:/);
    assert.equal((await auditRow("boom-1")).outcome, "error");
  });

  it("a failure outside the pipeline (request context) is a 500 problem without the error message", async () => {
    const local = Fastify({ genReqId: (req) => requestIdFromHeaders(req.headers) });
    const broken = {
      query: async () => {
        throw new Error("connect ECONNREFUSED db password=hunter2");
      },
    } as unknown as TestApp["pool"];
    const deps = { pool: broken, config: ctx.config, keyProvider: ctx.keyProvider, logger: local.log };
    defineOperationRoute(local, deps, { method: "get", url: "/api/v1/test/me", op: echoOp, parseInput: () => ok({}) });
    const res = await local.inject({ method: "GET", url: "/api/v1/test/me", headers: { ...bearer, "x-request-id": "ctx-down-1" } });
    const body = assertProblem(res, 500, "internal", "ctx-down-1");
    assert.equal(body.detail, "Internal error");
    assert.doesNotMatch(res.body, /hunter2|ECONNREFUSED/);
    await local.close();
  });
});

describe("authenticate → project scope → permission → parseInput → execute", () => {
  const post = (rid: string, url: string, headers: Record<string, string>, payload: string) =>
    app.inject({
      method: "POST",
      url,
      headers: { "content-type": "application/json", "x-request-id": rid, ...headers },
      payload,
    });
  const bare = (res: { statusCode: number; json(): unknown }) => {
    const { request_id: _rid, ...rest } = res.json() as Record<string, unknown>;
    return { status: res.statusCode, body: rest };
  };

  it("unauthenticated: 401 with no validation details and parseInput never runs", async () => {
    const before = seen.parseInput;
    const plain = bare(await post("ord-401-ok", "/api/v1/test/projects/reqalm/items", {}, '{"title":"t"}'));
    assert.equal(plain.status, 401);
    for (const [rid, url, payload] of [
      ["ord-401-badbody", "/api/v1/test/projects/reqalm/items", '{"title":7}'],
      ["ord-401-badid", "/api/v1/test/projects/%20/items", '{"title":7}'],
      ["ord-401-badjson", "/api/v1/test/projects/%20reqalm/items", "{"],
    ] as const) {
      const res = await post(rid, url, {}, payload);
      assertProblem(res, 401, "unauthenticated", rid);
      assert.deepEqual(bare(res), plain, rid);
      assert.equal((await auditRow(rid)).outcome, "deny", rid);
    }
    assert.equal(seen.parseInput, before, "parseInput is not called for an unauthenticated caller");
  });

  it("authenticated, no grant or malformed id: 404 identical to a missing project, before parseInput", async () => {
    const before = seen.parseInput;
    const missing = await post("ord-404-missing", "/api/v1/test/projects/no-such/items", bearer, '{"title":"t"}');
    assertProblem(missing, 404, "not_found", "ord-404-missing");
    for (const [rid, url, payload] of [
      ["ord-404-nogrant", "/api/v1/test/projects/ungranted/items", '{"title":7}'],
      ["ord-404-blank", "/api/v1/test/projects/%20/items", '{"title":"t"}'],
      ["ord-404-padded", "/api/v1/test/projects/reqalm%20/items", '{"title":"t"}'],
      ["ord-404-tab-badjson", "/api/v1/test/projects/%09reqalm/items", "{"],
    ] as const) {
      const res = await post(rid, url, bearer, payload);
      assert.deepEqual(bare(res), bare(missing), rid);
      assert.equal((await auditRow(rid)).outcome, "deny", rid);
    }
    assert.equal((await auditRow("ord-404-padded")).project_id, null, "raw id is not audited");
    assert.equal(seen.parseInput, before, "parseInput is not called outside the caller's scope");
  });

  it("authorized with a bad body: 400 Problem Details with the request id, audited without raw input", async () => {
    const executed = seen.execute;
    const res = await post("ord-400-body", "/api/v1/test/projects/reqalm/items", bearer, '{"title":"","note":"RAW-4711"}');
    const body = assertProblem(res, 400, "validation", "ord-400-body");
    assert.equal((body.details as { slice: string }).slice, "body");
    assert.doesNotMatch(res.body, /RAW-4711/);
    const row = await auditRow("ord-400-body");
    assert.equal(row.operation, "test.items.create");
    assert.equal(row.outcome, "error");
    assert.equal(row.project_id, "reqalm");
    assert.deepEqual(row.detail, { error_code: "validation" });
    assert.equal(seen.execute, executed, "execute does not run on invalid input");
  });

  it("authorized with a good body: executes once and audits allow", async () => {
    const res = await post("ord-200", "/api/v1/test/projects/reqalm/items", bearer, '{"title":"t"}');
    assert.equal(res.statusCode, 200);
    assert.deepEqual((res.json() as { data: unknown }).data, { created: "t" });
    assert.equal((await auditRow("ord-200")).outcome, "allow");
  });

  it("input naming another project than the checked scope fails closed (500, not executed)", async () => {
    const executed = seen.execute;
    const res = await post("ord-misbound", "/api/v1/test/projects/reqalm/misbound", bearer, '{"projectId":"ungranted"}');
    assertProblem(res, 500, "internal", "ord-misbound");
    assert.equal(seen.execute, executed);
    assert.equal((await auditRow("ord-misbound")).outcome, "error");
  });

  it("projectIdSchema accepts slug ids only", () => {
    for (const id of ["reqalm", "a-b", "secret-proj", "ungranted", "no-such"]) {
      assert.equal(projectIdSchema.safeParse(id).success, true, id);
    }
    for (const bad of ["", " ", " reqalm", "reqalm ", "\treqalm", "A", "a_b", "a.b", "-bad", "x".repeat(65), 7, undefined]) {
      assert.equal(projectIdSchema.safeParse(bad).success, false, String(bad));
    }
  });

  it("pre-handler body errors run auth before validation (reachedHandler guard)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/test/projects/reqalm/items",
      headers: { "content-type": "application/json", "x-request-id": "ord-prehandler-401" },
      payload: "{",
    });
    assertProblem(res, 401, "unauthenticated", "ord-prehandler-401");
    assert.equal((await auditRow("ord-prehandler-401")).outcome, "deny");
  });
});

describe("defineOperationRoute registration", () => {
  const exec = async () => ok({});
  const scoped = { projectScoped: true, projectIdFromInput: (i: { projectId: string }) => i.projectId };
  function register(op: unknown, parseInput: unknown = () => ok({ projectId: "reqalm" })) {
    const local = Fastify();
    const deps = { pool: ctx.pool, config: ctx.config, keyProvider: ctx.keyProvider, logger: local.log };
    const url = "/api/v1/test/:projectId/bind";
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

  it("throws on a project-scoped route without a :projectId path param", () => {
    const local = Fastify();
    const deps = { pool: ctx.pool, config: ctx.config, keyProvider: ctx.keyProvider, logger: local.log };
    for (const url of ["/api/v1/test/items", "/api/v1/test/:project/items", "/api/v1/test/:projectIdx"]) {
      assert.throws(
        () =>
          defineOperationRoute(local, deps, {
            method: "get",
            url,
            op: { name: "x.y", permission: "requirement:read", execute: async () => ok({}), ...scoped } as never,
            parseInput: () => ok({ projectId: "reqalm" }),
          }),
        /:projectId path param/,
        url,
      );
      assert.equal(local.hasRoute({ method: "GET", url }), false);
    }
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
