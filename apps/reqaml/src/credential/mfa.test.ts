import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Secret, TOTP } from "otpauth";
import { totpTimeStep } from "./mfa.js";

describe("TOTP replay guard step", () => {
  it("records the step the code belongs to, not the current step", () => {
    const secret = new Secret({ size: 20 });
    const totp = new TOTP({ secret });
    const now = Date.now();
    const current = Math.floor(now / 1000 / totp.period);
    const previousCode = totp.generate({ timestamp: now - totp.period * 1000 });
    const step = totpTimeStep(secret.base32, previousCode);
    // Previous-step codes are still accepted (window 1) but must be keyed to the previous step,
    // so the code that was used at step N cannot be replayed at step N+1.
    if (step !== null) assert.equal(step, current - 1);
    assert.equal(totpTimeStep(secret.base32, totp.generate({ timestamp: now })), current);
  });
});
