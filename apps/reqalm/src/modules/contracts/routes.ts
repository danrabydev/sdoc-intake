import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pageQuerySchema } from "../../core/paging.js";
import {
  defineOperationRoute,
  parseZodInput,
  projectIdSchema,
} from "../../http/define-operation-route.js";
import { CONTRACT_ID } from "../../http/project-id.js";
import type { OperationDef } from "../../core/operation.js";
import { ok } from "../../core/service-result.js";
import type { RequestContextDeps } from "../../core/request-context.js";
import type { PageResult } from "../../core/paging.js";
import {
  getContract,
  listContractReleases,
  listContractScope,
  listContracts,
  type ContractDetailDto,
  type ContractReleaseDto,
  type ContractScopeLineDto,
  type ContractSummaryDto,
  type GetContractInput,
  type ListContractReleasesInput,
  type ListContractScopeInput,
  type ListContractsInput,
} from "./contracts.service.js";

const contractParams = z.object({
  projectId: projectIdSchema,
  contractId: z.string().regex(CONTRACT_ID, "invalid contract id"),
});

const denyAsMissing = {
  permissionDeniedAsNotFound: true as const,
  permissionDeniedDetail: "Contract not found",
};

function contractReadOp<TIn extends { projectId: string; contractId?: string }, TOut>(
  name: string,
  execute: OperationDef<TIn, TOut>["execute"],
  targetId: (input: TIn) => string | null,
): OperationDef<TIn, TOut> {
  return {
    name,
    permission: "contract:read",
    projectScoped: true,
    ...denyAsMissing,
    projectIdFromInput: (input) => input.projectId,
    auditMeta: (input) => ({
      projectId: input.projectId,
      targetType: "contract",
      targetId: targetId(input),
    }),
    execute,
  };
}

const listContractsOp = contractReadOp<ListContractsInput, PageResult<ContractSummaryDto>>(
  "contracts.list",
  listContracts,
  () => null,
);
const getContractOp = contractReadOp<GetContractInput, ContractDetailDto>(
  "contracts.get",
  getContract,
  (i) => i.contractId,
);
const listScopeOp = contractReadOp<ListContractScopeInput, PageResult<ContractScopeLineDto>>(
  "contracts.list_scope",
  listContractScope,
  (i) => i.contractId,
);
const listReleasesOp = contractReadOp<ListContractReleasesInput, { items: ContractReleaseDto[] }>(
  "contracts.list_releases",
  listContractReleases,
  (i) => i.contractId,
);

export function registerContractRoutes(app: FastifyInstance, deps: RequestContextDeps): void {
  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/contracts",
    op: listContractsOp,
    parseInput: (req) => {
      const params = parseZodInput(z.object({ projectId: projectIdSchema }), req.params, "params");
      if (!params.ok) return params;
      const query = parseZodInput(pageQuerySchema, req.query, "query");
      if (!query.ok) return query;
      return ok({ projectId: params.data.projectId, ...query.data });
    },
    schema: { tags: ["contracts"], summary: "List contracts with scope and release counts" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/contracts/:contractId",
    op: getContractOp,
    parseInput: (req) => parseZodInput(contractParams, req.params, "params"),
    schema: { tags: ["contracts"], summary: "Read a contract" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/contracts/:contractId/scope",
    op: listScopeOp,
    parseInput: (req) => {
      const params = parseZodInput(contractParams, req.params, "params");
      if (!params.ok) return params;
      const query = parseZodInput(pageQuerySchema, req.query, "query");
      if (!query.ok) return query;
      return ok({ ...params.data, ...query.data });
    },
    schema: { tags: ["contracts"], summary: "Paged in_scope_of lines for a contract" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/projects/:projectId/contracts/:contractId/releases",
    op: listReleasesOp,
    parseInput: (req) => parseZodInput(contractParams, req.params, "params"),
    schema: { tags: ["contracts"], summary: "Release ids covered by a contract" },
  });
}
