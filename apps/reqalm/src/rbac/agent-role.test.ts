import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { effectiveRoles, resolveAgentRole } from "./agent-role.js";
import { permissionsForRoles } from "./enforce.js";

describe("agent role least privilege", () => {
  it("defaults to Reader when granted", () => {
    assert.deepEqual(resolveAgentRole(undefined, ["Reader", "Author"]), { ok: true, role: "Reader" });
  });

  it("allows Author only when granted", () => {
    assert.deepEqual(resolveAgentRole("Author", ["Reader", "Author"]), { ok: true, role: "Author" });
    assert.equal(resolveAgentRole("Author", ["Reader"]).ok, false);
  });

  it("refuses roles above Author even if the principal holds them", () => {
    for (const role of ["Project admin", "Developer", "Security", "Client admin"]) {
      const r = resolveAgentRole(role, ["Reader", "Author", role]);
      assert.equal(r.ok, false, role);
    }
  });

  it("narrows authorization to the token role", () => {
    const granted = ["Reader", "Author", "Project admin"];
    assert.deepEqual(effectiveRoles(granted, { reqalm_role: "Reader" }), ["Reader"]);
    assert.equal(
      permissionsForRoles(effectiveRoles(granted, { reqalm_role: "Reader" })).has("grant:manage"),
      false,
    );
    assert.equal(
      permissionsForRoles(effectiveRoles(granted, { reqalm_role: "Reader" })).has("requirement:write"),
      false,
    );
    assert.equal(
      permissionsForRoles(effectiveRoles(granted, { reqalm_role: "Author" })).has("requirement:write"),
      true,
    );
  });

  it("drops a token role that is no longer granted, and treats unbound agent tokens as Reader", () => {
    assert.deepEqual(effectiveRoles(["Reader"], { reqalm_role: "Author" }), []);
    assert.deepEqual(effectiveRoles(["Reader", "Project admin"], { agent_name: "x" }), ["Reader"]);
    assert.deepEqual(effectiveRoles(["Reader", "Project admin"], {}), ["Reader", "Project admin"]);
  });
});
