import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from "fastify";
import type { ZodType } from "zod";
import { mapServiceResultToHttp, sendProblem } from "../core/http-envelope.js";
import { runOperation, type OperationDef } from "../core/operation.js";
import { buildRequestContext, type RequestContextDeps } from "../core/request-context.js";
import { err, ok, type ServiceResult } from "../core/service-result.js";
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

/** Errors Fastify raises before the handler (body parsing, media type, size) or that escape it. */
function operationRouteErrorHandler(error: FastifyError, req: FastifyRequest, reply: FastifyReply) {
  const status = error.statusCode ?? 500;
  if (status >= 400 && status < 500) {
    return sendProblem(reply, req.id, status, "validation", "Invalid request", {
      reason: error.code ?? "bad_request",
    });
  }
  req.log.error({ err: error, request_id: req.id }, "operation_route_failed");
  return sendProblem(reply, req.id, 500, "internal", "Internal error");
}

/**
 * The only way to register a business route under `/api/` (enforced by route-security.test.ts).
 * Derives `reqalmSecurity` from the operation and runs context → parseInput → runOperation → envelope.
 */
export function defineOperationRoute<TIn, TOut>(
  app: FastifyInstance,
  deps: RequestContextDeps,
  options: DefineOperationRouteOptions<TIn, TOut>,
): void {
  const { method, url, op, parseInput, schema } = options;
  const inputKeys = schema ? INPUT_SCHEMA_KEYS.filter((k) => k in schema) : [];
  if (inputKeys.length > 0) {
    throw new Error(`${method} ${url}: validate ${inputKeys.join(", ")} in parseInput, not in schema`);
  }
  const operationRef: OperationRouteRef = {
    name: op.name,
    permission: op.permission,
    projectScoped: op.projectScoped,
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
    errorHandler: operationRouteErrorHandler,
    handler: async (req, reply) => {
      const ctx = await buildRequestContext(req, { ...deps, logger: req.log });
      const input = parseInput(req);
      if (!input.ok) {
        return mapServiceResultToHttp(reply, ctx.requestId, input);
      }
      return mapServiceResultToHttp(reply, ctx.requestId, await runOperation(ctx, op, input.data));
    },
  };
  app.route(route);
}
