/**
 * Slug id rules for path params, shared by request validation and log/span redaction.
 * Dependency-free on purpose: telemetry bootstrap imports this before instrumented modules load.
 */

/** Slug: lowercase alphanumerics and hyphens, starting with an alphanumeric, 1–64 chars. */
export const SLUG_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const PROJECT_ID_SLUG = SLUG_ID;
type PathSegmentRedactionRule = { prefix: string; valid: (segment: string) => boolean };

/** Requirement line id (base_uid) in dogfood: alphanumerics plus . _ - */
export const REQUIREMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Release id in dogfood: slug (same rules as project id). */
export const RELEASE_ID = SLUG_ID;

/** Contract id in dogfood: slug (same rules as project id). */
export const CONTRACT_ID = SLUG_ID;

/** Catalog def id in dogfood: slug (same rules as project id). */
export const CATALOG_ID = SLUG_ID;

/** Catalog imprint id: lowercase slug chars plus . @ _ - */
export const IMPRINT_ID = /^[a-z0-9][a-z0-9.@_-]{0,159}$/;

/** Catalog control id (item uid): same rules as requirement line id. */
export const CONTROL_ID = REQUIREMENT_ID;

const DEFAULT_SEGMENT_RULES: PathSegmentRedactionRule[] = [
  { prefix: "/projects/", valid: (s) => SLUG_ID.test(s) },
  { prefix: "/clients/", valid: (s) => SLUG_ID.test(s) },
  { prefix: "/requirements/", valid: (s) => REQUIREMENT_ID.test(s) },
  { prefix: "/releases/", valid: (s) => RELEASE_ID.test(s) },
  { prefix: "/contracts/", valid: (s) => CONTRACT_ID.test(s) },
  { prefix: "/catalogs/", valid: (s) => CATALOG_ID.test(s) },
  { prefix: "/imprints/", valid: (s) => IMPRINT_ID.test(s) },
  { prefix: "/controls/", valid: (s) => CONTROL_ID.test(s) },
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
