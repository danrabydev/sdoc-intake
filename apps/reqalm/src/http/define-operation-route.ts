import type { FastifyInstance, FastifyRequest, RouteShorthandOptions } from "fastify";
import type { ZodType } from "zod";
import { mapServiceResultToHttp } from "../core/http-envelope.js";
import { runOperation, type OperationDef } from "../core/operation.js";
import {
  buildRequestContext,
  type RequestContextDeps,
} from "../core/request-context.js";
import { err, ok, type ServiceResult } from "../core/service-result.js";
import {
  type OperationRouteRef,
  type RouteSecurity,
  securityFromOperationRef,
} from "./route-security.js";

export type OperationRouteSchema = NonNullable<RouteShorthandOptions["schema"]>;

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

function routeConfigForOperation<TIn, TOut>(
  op: OperationDef<TIn, TOut>,
): RouteShorthandOptions["config"] {
  const operationRef: OperationRouteRef = {
    name: op.name,
    permission: op.permission,
    projectScoped: op.projectScoped,
  };
  const reqalmSecurity = securityFromOperationRef(operationRef);
  return {
    reqalmSecurity,
    reqalmOperationRoute: true,
    reqalmOperationRef: operationRef,
  };
}

async function handleOperationRoute<TIn, TOut>(
  req: FastifyRequest,
  reply: Parameters<typeof mapServiceResultToHttp>[0],
  deps: RequestContextDeps,
  op: OperationDef<TIn, TOut>,
  parseInput: (req: FastifyRequest) => ServiceResult<TIn>,
): Promise<unknown> {
  const ctx = await buildRequestContext(req, { ...deps, logger: req.log });
  const inputResult = parseInput(req);
  if (!inputResult.ok) {
    return mapServiceResultToHttp(reply, ctx.requestId, inputResult);
  }
  const result = await runOperation(ctx, op, inputResult.data);
  return mapServiceResultToHttp(reply, ctx.requestId, result);
}

/**
 * Register a business route under `/api/v1` (feature modules only).
 * Derives `reqalmSecurity` from the operation and runs the standard context → operation → envelope pipeline.
 */
export function defineOperationRoute<TIn, TOut>(
  app: FastifyInstance,
  deps: RequestContextDeps,
  options: DefineOperationRouteOptions<TIn, TOut>,
): void {
  const { method, url, op, parseInput, schema } = options;
  const routeOptions: RouteShorthandOptions = {
    config: routeConfigForOperation(op),
    ...(schema ? { schema } : {}),
  };
  const handler = async (req: FastifyRequest, reply: Parameters<typeof mapServiceResultToHttp>[0]) =>
    handleOperationRoute(req, reply, deps, op, parseInput);

  switch (method) {
    case "get":
      app.get(url, routeOptions, handler);
      break;
    case "post":
      app.post(url, routeOptions, handler);
      break;
    case "put":
      app.put(url, routeOptions, handler);
      break;
    case "patch":
      app.patch(url, routeOptions, handler);
      break;
    case "delete":
      app.delete(url, routeOptions, handler);
      break;
    default: {
      const _exhaustive: never = method;
      throw new Error(`Unsupported HTTP method: ${_exhaustive}`);
    }
  }
}

export function securityFromOperation<TIn, TOut>(
  op: OperationDef<TIn, TOut>,
): RouteSecurity {
  return securityFromOperationRef({
    name: op.name,
    permission: op.permission,
    projectScoped: op.projectScoped,
  });
}
