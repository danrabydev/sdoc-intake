/** Browse helpers shared by browse.js and browse-relations.js (breaks import cycles). */

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
