/**
 * Project id rule, shared by request validation and log/span redaction. Dependency-free on purpose:
 * the telemetry bootstrap imports it before any instrumented module is loaded.
 */

/** Slug: lowercase alphanumerics and hyphens, starting with an alphanumeric, 1–64 chars. */
export const PROJECT_ID_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

const PROJECT_PATH_SEGMENT = /(\/projects\/)([^/?#]*)/g;

/**
 * Logs and span attributes never carry a project id that fails the slug rule: the raw path segment
 * after `/projects/` is replaced with `[invalid]` (valid ids are kept as they are).
 */
export function redactInvalidProjectIds(url: string): string {
  return url.replace(PROJECT_PATH_SEGMENT, (match, prefix: string, segment: string) =>
    PROJECT_ID_SLUG.test(segment) ? match : `${prefix}[invalid]`,
  );
}
