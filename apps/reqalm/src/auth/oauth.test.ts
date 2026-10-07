import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { validateAuthorizePkce, verifyPkceS256 } from "./pkce.js";

describe("PKCE", () => {
  it("accepts S256 verifier/challenge pair", () => {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256")
      .update(verifier)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    assert.equal(verifyPkceS256(verifier, challenge), true);
  });

  it("rejects plain method at authorize validation", () => {
    assert.match(
      validateAuthorizePkce("plain", "abc") ?? "",
      /S256/i,
    );
  });

  it("requires code_challenge", () => {
    assert.equal(validateAuthorizePkce("S256", undefined), "code_challenge required");
  });
});
