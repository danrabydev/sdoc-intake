import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FastifyReply } from "fastify";
import type { AppConfig } from "../config.js";
import { setSessionCookies } from "./web-session.js";

function capture(mode: "development" | "production") {
  const cookies: Record<string, Record<string, unknown>> = {};
  const reply = {
    setCookie(name: string, _value: string, opts: Record<string, unknown>) {
      cookies[name] = opts;
      return reply;
    },
  } as unknown as FastifyReply;
  process.env.REQALM_SESSION_SECRET = "test-secret";
  setSessionCookies(reply, { REQALM_MODE: mode } as AppConfig, "sid", "csrf");
  return cookies;
}

describe("web session cookies", () => {
  it("session cookie is HttpOnly + SameSite=Lax, Secure in production", () => {
    const prod = capture("production");
    assert.equal(prod.reqalm_session.httpOnly, true);
    assert.equal(prod.reqalm_session.sameSite, "lax");
    assert.equal(prod.reqalm_session.secure, true);
    assert.equal(prod.reqalm_csrf.secure, true);
  });
  it("dev over http does not set Secure", () => {
    assert.equal(capture("development").reqalm_session.secure, false);
  });
});
