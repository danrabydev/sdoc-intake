import type { FastifyInstance } from "fastify";
import { pageQuerySchema } from "../../core/paging.js";
import { clientParamsSchema, defineOperationRoute, parseZodInput } from "../../http/define-operation-route.js";
import type { OperationDef } from "../../core/operation.js";
import type { RequestContextDeps } from "../../core/request-context.js";
import {
  getClient,
  listClients,
  type ClientDto,
  type GetClientInput,
  type ListClientsInput,
} from "./clients.service.js";
import type { PageResult } from "../../core/paging.js";

const listClientsOp: OperationDef<ListClientsInput, PageResult<ClientDto>> = {
  name: "clients.list",
  permission: "client:list",
  listScope: true,
  auditMeta: () => ({ targetType: "client", targetId: null }),
  execute: listClients,
};

const getClientOp: OperationDef<GetClientInput, ClientDto> = {
  name: "clients.get",
  permission: "client:list",
  listScope: true,
  auditMeta: (input) => ({
    targetType: "client",
    targetId: input.clientId,
  }),
  execute: getClient,
};

export function registerClientRoutes(app: FastifyInstance, deps: RequestContextDeps): void {
  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/clients",
    op: listClientsOp,
    parseInput: (req) => parseZodInput(pageQuerySchema, req.query, "query"),
    schema: { tags: ["clients"], summary: "List clients visible to caller grants" },
  });

  defineOperationRoute(app, deps, {
    method: "get",
    url: "/api/v1/clients/:clientId",
    op: getClientOp,
    parseInput: (req) => parseZodInput(clientParamsSchema, req.params, "params"),
    schema: { tags: ["clients"], summary: "Read one client (grant-scoped)" },
  });
}
