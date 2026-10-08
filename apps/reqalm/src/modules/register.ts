import type { FastifyInstance } from "fastify";
import type { RequestContextDeps } from "../core/request-context.js";
import { registerClientRoutes } from "./clients/routes.js";
import { registerGrantRoutes } from "./grants/routes.js";
import { registerIdentityRoutes } from "./identity/routes.js";
import { registerProjectRoutes } from "./projects/routes.js";
import { registerRequirementRoutes } from "./requirements/routes.js";

/** Register feature modules (service + routes). Add new modules here. */
export function registerFeatureModules(app: FastifyInstance, deps: RequestContextDeps): void {
  registerIdentityRoutes(app, deps);
  registerClientRoutes(app, deps);
  registerProjectRoutes(app, deps);
  registerRequirementRoutes(app, deps);
  registerGrantRoutes(app, deps);
}
