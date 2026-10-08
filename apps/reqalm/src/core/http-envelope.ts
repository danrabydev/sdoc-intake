import { STATUS_CODES } from "node:http";
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

const ERROR_STATUS: Record<ServiceErrorCode, number> = {
  not_found: 404,
  forbidden: 403,
  unauthenticated: 401,
  validation: 400,
  conflict: 409,
  internal: 500,
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
  return sendProblem(reply, requestId, ERROR_STATUS[code], code, message, details);
}

/** RFC 9457 Problem Details body with `application/problem+json`. */
export function sendProblem(
  reply: FastifyReply,
  requestId: string,
  status: number,
  code: ServiceErrorCode,
  detail: string,
  details?: Record<string, unknown>,
): FastifyReply {
  const body: ApiErrorBody = {
    type: `https://reqalm.dev/problems/${code}`,
    title: STATUS_CODES[status] ?? "Error",
    status,
    code,
    detail,
    request_id: requestId,
    ...(details ? { details } : {}),
  };
  return reply.code(status).type("application/problem+json").send(body);
}
