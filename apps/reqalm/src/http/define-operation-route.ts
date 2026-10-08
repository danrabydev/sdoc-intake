import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from "fastify";
import { z, type ZodType } from "zod";
import { mapServiceResultToHttp, sendProblem } from "../core/http-envelope.js";
import { runOperationCall, type OperationDef } from "../core/operation.js";
import { buildRequestContext, type RequestContextDeps } from "../core/request-context.js";
import { err, ok, type ServiceResult } from "../core/service-result.js";
import { PROJECT_ID_SLUG } from "./project-id.js";
import { type OperationRouteRef, securityFromOperationRef } from "./route-security.js";

/**
 * Documentation and serialization only. Request input is validated once, by `parseInput` (Zod), so every
 * validation failure is a Problem Details response; Fastify's own body/querystring/params/headers
 * validators are not allowed here.
 */
export type OperationRouteSchema = {
  tags?: string[];
  summary?: string;
  description?: string;
  response?: Record<string, unknown>;
};

const INPUT_SCHEMA_KEYS = ["body", "querystring", "params", "headers"] as const;

export type DefineOperationRouteOptions<TIn, TOut> = {
  method: "get" | "post" | "put" | "patch" | "delete";
  url: string;
  op: OperationDef<TIn, TOut>;
  parseInput: (req: FastifyRequest) => ServiceResult<TIn>;
  schema?: OperationRouteSchema;
};

/** Parse and validate a single request slice with Zod; failures become `validation` ServiceResults. */
export function parseZodInput<T>(
  schema: ZodType<T>,
  value: unknown,
  slice: "params" | "query" | "body",
): ServiceResult<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err("validation", "Invalid request input", {
    slice,
    issues: parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
  });
}

export const projectIdSchema = z.string().regex(PROJECT_ID_SLUG, "invalid project id");

/**
 * Project scope of a project-scoped route: the `:projectId` path param, parsed before input validation.
 * An unparsable id is no scope, which the pipeline answers (after authentication) as not_found, the same
 * response as a missing or ungranted project.
 */
function projectScopeFromPath(req: FastifyRequest): string | undefined {
  const parsed = projectIdSchema.safeParse((req.params as Record<string, unknown> | undefined)?.projectId);
  return parsed.success ? parsed.data : undefined;
}

const PROJECT_ID_PATH_PARAM = /\/:projectId(\/|$)/;

/**
 * Fail closed at registration: a route must name its operation, its access (permission or explicitly
 * authenticated-only) and, for a permission, the project it is checked against. A permission without a
 * project would be authorized against the union of the caller's grants in every project.
 */
function assertOperationBinding(
  label: string,
  url: string,
  op: Partial<Record<keyof OperationDef<unknown, unknown>, unknown>> | undefined,
  parseInput: unknown,
): void {
  const fail = (why: string): never => {
    throw new Error(`${label}: ${why}`);
  };
  if (!op || typeof op.name !== "string" || op.name === "" || typeof op.execute !== "function") {
    fail("missing operation (name and execute)");
  }
  if (typeof parseInput !== "function") fail("missing parseInput");
  const permission = op!.permission;
  if (permission !== undefined && (typeof permission !== "string" || permission === "")) {
    fail("permission must be a non-empty string");
  }
  if (!permission && op!.authenticatedOnly !== true) {
    fail("missing permission (or authenticatedOnly: true)");
  }
  if (permission && op!.authenticatedOnly) fail("permission and authenticatedOnly are exclusive");
  if (permission && op!.projectScoped !== true) {
    fail("permission without project scope (set projectScoped and projectIdFromInput)");
  }
  if (op!.projectScoped && typeof op!.projectIdFromInput !== "function") {
    fail("projectScoped without projectIdFromInput");
  }
  if (op!.projectScoped && !PROJECT_ID_PATH_PARAM.test(url)) {
    fail("projectScoped route must take the project from a :projectId path param");
  }
}

/**
 * The only way to register a business route under `/api/` (enforced by route-security.test.ts).
 * Derives `reqalmSecurity` from the operation and runs authenticate → project scope → permission →
 * parseInput → execute → audit → envelope or Problem Details.
 */
export function defineOperationRoute<TIn, TOut>(
  app: FastifyInstance,
  deps: RequestContextDeps,
  options: DefineOperationRouteOptions<TIn, TOut>,
): void {
  const { method, url, op, parseInput, schema } = options;
  assertOperationBinding(`${method.toUpperCase()} ${url}`, url, op, parseInput);
  const inputKeys = schema ? INPUT_SCHEMA_KEYS.filter((k) => k in schema) : [];
  if (inputKeys.length > 0) {
    throw new Error(`${method} ${url}: validate ${inputKeys.join(", ")} in parseInput, not in schema`);
  }
  const operationRef: OperationRouteRef = {
    name: op.name,
    permission: op.permission,
    projectScoped: op.projectScoped,
  };
  const scopeOf = op.projectScoped ? projectScopeFromPath : () => undefined;
  const reachedHandler = new WeakSet<FastifyRequest>();

  const run = async (req: FastifyRequest, parse: () => ServiceResult<TIn>) => {
    const ctx = await buildRequestContext(req, { ...deps, logger: req.log });
    return runOperationCall(ctx, op, { projectId: scopeOf(req), parseInput: parse });
  };

  /**
   * Errors Fastify raises before the handler (unreadable body, media type, size) still go through
   * authentication, scope and permission first, so an unauthenticated or out-of-scope caller gets the
   * same 401/404 as anywhere else; for an authorized caller the failure is an audited validation error
   * that keeps Fastify's status (400/413/415). Anything else is a 500 without the error text.
   */
  const errorHandler = async (error: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    const status = error.statusCode ?? 500;
    let failure: unknown = error;
    if (status >= 400 && status < 500 && !reachedHandler.has(req)) {
      const reason = error.code ?? "bad_request";
      try {
        const result = await run(req, () => err("validation", "Invalid request", { reason }));
        if (!result.ok && result.error.code === "validation") {
          return sendProblem(reply, req.id, status, "validation", "Invalid request", { reason });
        }
        return mapServiceResultToHttp(reply, req.id, result);
      } catch (e) {
        failure = e;
      }
    }
    req.log.error({ err: failure, request_id: req.id }, "operation_route_failed");
    return sendProblem(reply, req.id, 500, "internal", "Internal error");
  };

  const route: RouteOptions = {
    method: method.toUpperCase() as Uppercase<typeof method>,
    url,
    ...(schema ? { schema } : {}),
    config: {
      reqalmSecurity: securityFromOperationRef(operationRef),
      reqalmOperationRoute: true,
      reqalmOperationRef: operationRef,
    },
    errorHandler,
    handler: async (req, reply) => {
      reachedHandler.add(req);
      return mapServiceResultToHttp(reply, req.id, await run(req, () => parseInput(req)));
    },
  };
  app.route(route);
}
