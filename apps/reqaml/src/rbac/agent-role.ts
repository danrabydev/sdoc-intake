/**
 * Least privilege for coding-agent tokens (client_credentials on reqaml-agent-dev).
 *
 * An agent token carries exactly one project role (`reqaml_role`), chosen at mint time. The role must
 * be one agents may hold at all (Reader or Author) *and* explicitly granted to the agent's own
 * identity on the project. Authorization for that token then uses only that role, never the rest of
 * the identity's grants.
 */
export const AGENT_ALLOWED_ROLES = ["Reader", "Author"] as const;
export const AGENT_DEFAULT_ROLE = "Reader";

export type AgentRoleResult =
  | { ok: true; role: string }
  | { ok: false; error: "invalid_scope"; description: string };

export function resolveAgentRole(
  requested: string | undefined,
  grantedRoles: readonly string[],
): AgentRoleResult {
  const role = requested?.trim() || AGENT_DEFAULT_ROLE;
  if (!(AGENT_ALLOWED_ROLES as readonly string[]).includes(role)) {
    return {
      ok: false,
      error: "invalid_scope",
      description: `agent tokens may only carry ${AGENT_ALLOWED_ROLES.join(" or ")}`,
    };
  }
  if (!grantedRoles.includes(role)) {
    return {
      ok: false,
      error: "invalid_scope",
      description: `role ${role} is not granted to this agent principal`,
    };
  }
  return { ok: true, role };
}

/**
 * Roles to authorize with. A token-bound role narrows the identity's grants to that single role
 * (and only if it is still granted). Agent tokens without a bound role fall back to Reader.
 */
export function effectiveRoles(
  identityRoles: readonly string[],
  token?: { readonly [claim: string]: unknown },
): string[] {
  const bound =
    typeof token?.reqaml_role === "string"
      ? token.reqaml_role
      : token?.agent_name
        ? AGENT_DEFAULT_ROLE
        : undefined;
  if (bound === undefined) return [...identityRoles];
  return identityRoles.includes(bound) ? [bound] : [];
}
