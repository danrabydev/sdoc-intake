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
  process.env.REQAML_SESSION_SECRET = "test-secret";
  setSessionCookies(reply, { REQAML_MODE: mode } as AppConfig, "sid", "csrf");
  return cookies;
}

describe("web session cookies", () => {
  it("session cookie is HttpOnly + SameSite=Lax, Secure in production", () => {
    const prod = capture("production");
    assert.equal(prod.reqaml_session.httpOnly, true);
    assert.equal(prod.reqaml_session.sameSite, "lax");
    assert.equal(prod.reqaml_session.secure, true);
    assert.equal(prod.reqaml_csrf.secure, true);
  });
  it("dev over http does not set Secure", () => {
    assert.equal(capture("development").reqaml_session.secure, false);
  });
});
