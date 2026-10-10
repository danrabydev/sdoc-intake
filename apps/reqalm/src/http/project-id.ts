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

/** Workflow profile id in dogfood (wf-* slug). */
export const WORKFLOW_PROFILE_ID = /^wf-[a-z0-9][a-z0-9-]{0,58}$/;

/** Gate id in dogfood (gate-* slug). */
export const WORKFLOW_GATE_ID = /^gate-[a-z0-9][a-z0-9-]{0,58}$/;

/** Action hook id in dogfood (hook-* slug). */
export const WORKFLOW_ACTION_HOOK_ID = /^hook-[a-z0-9][a-z0-9-]{0,58}$/;

/** Role binding id in dogfood (rb-* slug). */
export const WORKFLOW_ROLE_BINDING_ID = /^rb-[a-z0-9][a-z0-9-]{0,58}$/;

/** Approval record id in dogfood (ar-* slug). */
export const WORKFLOW_APPROVAL_RECORD_ID = /^ar-[a-z0-9][a-z0-9-]{0,58}$/;

/** SubjectKind registry id (PascalCase). */
export const WORKFLOW_SUBJECT_KIND_ID = /^[A-Z][A-Za-z0-9]{0,63}$/;

const DEFAULT_SEGMENT_RULES: PathSegmentRedactionRule[] = [
  { prefix: "/projects/", valid: (s) => SLUG_ID.test(s) },
  { prefix: "/clients/", valid: (s) => SLUG_ID.test(s) },
  { prefix: "/requirements/", valid: (s) => REQUIREMENT_ID.test(s) },
  { prefix: "/releases/", valid: (s) => RELEASE_ID.test(s) },
  { prefix: "/contracts/", valid: (s) => CONTRACT_ID.test(s) },
  { prefix: "/catalogs/", valid: (s) => CATALOG_ID.test(s) },
  { prefix: "/imprints/", valid: (s) => IMPRINT_ID.test(s) },
  { prefix: "/controls/", valid: (s) => CONTROL_ID.test(s) },
  { prefix: "/workflow/profiles/", valid: (s) => WORKFLOW_PROFILE_ID.test(s) },
  { prefix: "/workflow/gates/", valid: (s) => WORKFLOW_GATE_ID.test(s) },
  { prefix: "/workflow/action-hooks/", valid: (s) => WORKFLOW_ACTION_HOOK_ID.test(s) },
  { prefix: "/workflow/role-bindings/", valid: (s) => WORKFLOW_ROLE_BINDING_ID.test(s) },
  { prefix: "/workflow/approval-records/", valid: (s) => WORKFLOW_APPROVAL_RECORD_ID.test(s) },
  { prefix: "/workflow/subject-kinds/", valid: (s) => WORKFLOW_SUBJECT_KIND_ID.test(s) },
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
