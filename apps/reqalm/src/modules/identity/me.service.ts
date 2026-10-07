import { authProfileFromEnv } from "../../auth/profile.js";
import { ok, type ServiceResult } from "../../core/service-result.js";
import type { RequestContext } from "../../core/request-context.js";

export type MeDto = {
  identity_id: string;
  auth_profile: ReturnType<typeof authProfileFromEnv>;
  grants: Array<{ project_id: string; role: string }>;
  agent_name: string | null;
  token_role: string | null;
  effective_roles: string[];
};

export async function buildMeDto(ctx: RequestContext): Promise<ServiceResult<MeDto>> {
  if (!ctx.identityId) {
    return { ok: false, error: { code: "unauthenticated", message: "Authentication required" } };
  }
  return ok({
    identity_id: ctx.identityId,
    auth_profile: authProfileFromEnv(ctx.config),
    grants: ctx.projectGrants,
    agent_name: ctx.agentName,
    token_role: ctx.tokenRole,
    effective_roles: ctx.effectiveRoles,
  });
}
