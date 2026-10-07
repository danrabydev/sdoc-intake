import type { FastifyReply } from "fastify";
import type { ServiceErrorCode, ServiceResult } from "./service-result.js";

export type ApiErrorBody = {
  type: string;
  title: string;
  status: number;
  code: ServiceErrorCode;
  detail: string;
  request_id: string;
  details?: Record<string, unknown>;
};

export type ApiDataEnvelope<T> = {
  data: T;
  request_id: string;
};

export type ApiListEnvelope<T> = {
  data: T[];
  request_id: string;
  meta: { total: number; limit?: number; offset?: number };
};

const ERROR_STATUS: Record<ServiceErrorCode, number> = {
  not_found: 404,
  forbidden: 403,
  unauthenticated: 401,
  validation: 400,
  conflict: 409,
  internal: 500,
};

const ERROR_TITLE: Record<ServiceErrorCode, string> = {
  not_found: "Not Found",
  forbidden: "Forbidden",
  unauthenticated: "Unauthorized",
  validation: "Bad Request",
  conflict: "Conflict",
  internal: "Internal Server Error",
};

export function mapServiceResultToHttp<T>(
  reply: FastifyReply,
  requestId: string,
  result: ServiceResult<T>,
): FastifyReply {
  if (result.ok) {
    const body: ApiDataEnvelope<T> = { data: result.data, request_id: requestId };
    return reply.code(200).send(body);
  }
  const { code, message, details } = result.error;
  const status = ERROR_STATUS[code];
  const body: ApiErrorBody = {
    type: `https://reqalm.dev/problems/${code}`,
    title: ERROR_TITLE[code],
    status,
    code,
    detail: message,
    request_id: requestId,
    ...(details ? { details } : {}),
  };
  return reply.code(status).send(body);
}

export function sendListEnvelope<T>(
  reply: FastifyReply,
  requestId: string,
  data: T[],
  meta: { total: number; limit?: number; offset?: number },
): FastifyReply {
  const body: ApiListEnvelope<T> = { data, request_id: requestId, meta };
  return reply.code(200).send(body);
}
