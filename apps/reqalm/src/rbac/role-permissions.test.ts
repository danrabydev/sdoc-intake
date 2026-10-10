import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROLE_PERMISSIONS } from "./enforce.js";

/** Pinned with planning:read in browse roles; planning-read.test.ts asserts live route ops match. */
export const PLANNING_ROUTE_OPS = [
  "planning.iterations.list",
  "planning.iterations.get",
  "planning.change_sets.list",
  "planning.change_sets.get",
  "planning.work_item_links.list",
  "planning.work_item_links.get",
] as const;

const EXPECTED: Record<string, string[]> = {
  Reader: [
    "audit:read",
    "client:list",
    "contract:read",
    "planning:read",
    "grant:read",
    "project:list",
    "release:list",
    "release:read",
    "requirement:list",
    "requirement:read",
  ],
  Author: [
    "audit:read",
    "client:list",
    "contract:read",
    "planning:read",
    "grant:read",
    "project:list",
    "release:list",
    "release:read",
    "requirement:list",
    "requirement:read",
    "requirement:write",
  ],
  Developer: [
    "audit:read",
    "client:list",
    "contract:read",
    "planning:read",
    "grant:read",
    "project:list",
    "release:list",
    "release:read",
    "requirement:list",
    "requirement:read",
    "workitem:write",
  ],
  Tester: [
    "audit:read",
    "client:list",
    "contract:read",
    "planning:read",
    "grant:read",
    "project:list",
    "release:list",
    "release:read",
    "requirement:list",
    "requirement:read",
    "verification:write",
  ],
  "Release manager": [
    "audit:read",
    "client:list",
    "contract:read",
    "planning:read",
    "grant:read",
    "project:list",
    "release:list",
    "release:plan",
    "release:read",
    "release:ship",
    "requirement:list",
    "requirement:read",
  ],
  Security: [
    "audit:read",
    "client:list",
    "contract:read",
    "planning:read",
    "grant:read",
    "project:list",
    "release:list",
    "release:read",
    "requirement:list",
    "requirement:read",
    "security:apply",
  ],
  AO: [
    "audit:read",
    "client:list",
    "contract:read",
    "planning:read",
    "gate:approve",
    "grant:read",
    "project:list",
    "release:list",
    "release:read",
    "requirement:list",
    "requirement:read",
  ],
  Auditor: [
    "audit:read",
    "client:list",
    "contract:read",
    "planning:read",
    "grant:read",
    "project:list",
    "release:list",
    "release:read",
    "requirement:list",
    "requirement:read",
  ],
  "Project admin": [
    "audit:read",
    "client:list",
    "contract:read",
    "planning:read",
    "grant:manage",
    "grant:read",
    "project:list",
    "release:list",
    "release:read",
    "requirement:list",
    "requirement:read",
    "requirement:write",
  ],
  "Client admin": [
    "audit:read",
    "client:list",
    "client:manage",
    "contract:read",
    "planning:read",
    "grant:manage",
    "grant:read",
    "project:list",
    "release:list",
    "release:read",
    "requirement:list",
    "requirement:read",
  ],
  "Key custodian": ["audit:read", "key:manage"],
};

describe("ROLE_PERMISSIONS table", () => {
  it("pins each role's exact permission set", () => {
    assert.deepEqual(Object.keys(ROLE_PERMISSIONS).sort(), Object.keys(EXPECTED).sort());
    for (const [role, perms] of Object.entries(EXPECTED)) {
      assert.deepEqual([...(ROLE_PERMISSIONS[role] ?? [])].sort(), [...perms].sort(), role);
    }
  });

  it("Key custodian has no list/read-browse permissions", () => {
    const perms = ROLE_PERMISSIONS["Key custodian"] ?? new Set();
    for (const p of [
      "client:list",
      "project:list",
      "requirement:list",
      "requirement:read",
      "release:list",
      "release:read",
      "contract:list",
      "contract:read",
      "planning:read",
    ]) {
      assert.equal(perms.has(p), false, p);
    }
  });

  it("pins planning:read on browse roles and six route operation names", () => {
    for (const role of ["Reader", "Author", "Auditor"] as const) {
      assert.ok(ROLE_PERMISSIONS[role]?.has("planning:read"), role);
    }
    assert.equal(PLANNING_ROUTE_OPS.length, 6);
  });
});
