/** Browse helpers shared by browse.js and browse-relations.js (breaks import cycles). */

export const SLUG_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const REQUIREMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isValidSlugId(id) {
  return typeof id === "string" && SLUG_ID.test(id);
}
export function isValidRequirementId(id) {
  return typeof id === "string" && REQUIREMENT_ID.test(id);
}

export function appRequirementHref(projectId, requirementId) {
  return `/app/projects/${encodeURIComponent(projectId)}/requirements/${encodeURIComponent(requirementId)}`;
}

export async function loadJson(apiFn, path) {
  try {
    const res = await apiFn(path);
    if (!res) return { kind: "auth" };
    if (res.status === 404) return { kind: "not_found" };
    if (!res.ok) return { kind: "error", status: res.status };
    const body = await res.json();
    return { kind: "ok", data: body.data ?? body };
  } catch {
    return { kind: "error" };
  }
}
