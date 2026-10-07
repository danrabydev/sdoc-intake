/** Stable service-layer error codes mapped to HTTP by {@link mapServiceResultToHttp}. */
export type ServiceErrorCode =
  | "not_found"
  | "forbidden"
  | "unauthenticated"
  | "validation"
  | "conflict"
  | "internal";

export type ServiceError = {
  code: ServiceErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ServiceError };

export function ok<T>(data: T): ServiceResult<T> {
  return { ok: true, data };
}

export function err(
  code: ServiceErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ServiceResult<never> {
  return { ok: false, error: { code, message, details } };
}
