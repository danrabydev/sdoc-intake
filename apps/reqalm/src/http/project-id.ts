/**
 * Slug id rules for path params, shared by request validation and log/span redaction.
 * Dependency-free on purpose: telemetry bootstrap imports this before instrumented modules load.
 */

/** Slug: lowercase alphanumerics and hyphens, starting with an alphanumeric, 1–64 chars. */
export const SLUG_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const PROJECT_ID_SLUG = SLUG_ID;
type PathSegmentRedactionRule = { prefix: string; valid: (segment: string) => boolean };

const DEFAULT_SEGMENT_RULES: PathSegmentRedactionRule[] = [
  { prefix: "/projects/", valid: (s) => SLUG_ID.test(s) },
  { prefix: "/clients/", valid: (s) => SLUG_ID.test(s) },
];

export function redactInvalidPathParamIds(
  url: string,
  rules: PathSegmentRedactionRule[] = DEFAULT_SEGMENT_RULES,
): string {
  let out = url;
  for (const { prefix, valid } of rules) {
    const escaped = prefix.replace(/\//g, "\\/");
    const re = new RegExp(`(${escaped})([^/?#]*)`, "g");
    out = out.replace(re, (match, p: string, segment: string) =>
      valid(segment) ? match : `${p}[invalid]`,
    );
  }
  return out;
}

export function redactInvalidProjectIds(url: string): string {
  return redactInvalidPathParamIds(url);
}
