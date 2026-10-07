import { ok, type ServiceResult } from "../../core/service-result.js";
import type { RequestContext } from "../../core/request-context.js";

export type GrantManageInput = { projectId: string };

export type GrantManageDto = { ok: true; message: string };

export async function grantManageStub(
  _ctx: RequestContext,
  _input: GrantManageInput,
): Promise<ServiceResult<GrantManageDto>> {
  return ok({ ok: true, message: "grant manage authorized (stub)" });
}
