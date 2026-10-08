import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pageQuerySchema } from "../../core/paging.js";
import { defineOperationRoute, parseZodInput } from "../../http/define-operation-route.js";
import { SLUG_ID } from "../../http/project-id.js";
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

const clientIdSchema = z.string().regex(SLUG_ID, "invalid client id");

const clientParams = z.object({
  clientId: clientIdSchema,
});

const listClientsOp: OperationDef<ListClientsInput, PageResult<ClientDto>> = {
  name: "clients.list",
  permission: "client:list",
  auditMeta: () => ({ targetType: "client", targetId: null }),
  execute: listClients,
};

const getClientOp: OperationDef<GetClientInput, ClientDto> = {
  name: "clients.get",
  permission: "client:list",
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
    parseInput: (req) => parseZodInput(clientParams, req.params, "params"),
    schema: { tags: ["clients"], summary: "Read one client (grant-scoped)" },
  });
}
