// @ts-nocheck
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, beforeEach, afterEach } from "node:test";
import { JSDOM } from "jsdom";
import {
  encodeQrMatrix,
  buildMfaEnrollmentChildren,
  clearMfaEnrollmentUi,
  createMfaQrSvg,
  assertSvgEncodesOtpauthUri,
  setupKeyFromOtpauthUri,
  moduleGridFromMfaQrSvg,
  moduleGridsEqual,
} from "./public/mfa-enroll-ui.js";
import { renderLogin } from "./public/app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENDOR_QR_MIN = path.join(__dirname, "public/vendor/qr-min.js");
const VENDOR_QR_MIN_SHA256 = "0bebad1a102e61131ba2988d75985234395c187127dff724c2125cc75e868ac8";

const SAMPLE_URI =
  "otpauth://totp/ReqALM:sam-security@dev.local?secret=JBSWY3DPEHPK3PXP&issuer=ReqALM";

function loadVendoredQrMin() {
  const require = createRequire(import.meta.url);
  globalThis.QR = require("./public/vendor/qr-min.js");
}

function el(tag: string, props: Record<string, unknown> = {}, children: unknown[] = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "className") node.className = String(v);
    else if (k === "text") node.textContent = String(v);
    else node.setAttribute(k, String(v));
  }
  for (const child of children) node.append(child as Node);
  return node;
}

function installDom(url = "http://localhost/") {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url });
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  globalThis.FormData = dom.window.FormData;
  globalThis.Event = dom.window.Event;
  loadVendoredQrMin();
  return dom;
}

function assertEnrollmentPanelMatchesUri(enrollRoot: ParentNode, otpauthUri: string) {
  const svg = enrollRoot.querySelector("svg.mfa-qr") as SVGSVGElement | null;
  assert.ok(svg, "expected MFA QR svg");
  assertSvgEncodesOtpauthUri(svg, otpauthUri);
  const secret = setupKeyFromOtpauthUri(otpauthUri);
  assert.ok(secret, "expected secret in otpauth URI");
  assert.equal(enrollRoot.querySelector("#mfa-setup-key")?.textContent, secret);
  assert.equal(enrollRoot.querySelector("#mfa-otpauth-uri")?.textContent, otpauthUri);
}

describe("MFA enrollment QR (client-side)", () => {
  beforeEach(() => installDom());
  afterEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
    delete (globalThis as { QR?: unknown }).QR;
  });

  it("vendored qr-min.js matches upstream npm 1.0.0 bytes (sha256)", () => {
    const digest = createHash("sha256").update(readFileSync(VENDOR_QR_MIN)).digest("hex");
    assert.equal(digest, VENDOR_QR_MIN_SHA256);
  });

  it("renders SVG whose modules match the encoder for the enroll otpauth URI", () => {
    const networkCalls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      networkCalls.push(String(url));
      throw new Error("network forbidden during QR render");
    }) as typeof fetch;

    const svg = createMfaQrSvg(document, SAMPLE_URI);
    assert.equal(networkCalls.length, 0);
    assert.equal(svg.getAttribute("role"), "img");
    assert.equal(svg.getAttribute("aria-label"), "QR code for authenticator setup");
    assert.equal(svg.getAttribute("shape-rendering"), "crispEdges");
    assertSvgEncodesOtpauthUri(svg, SAMPLE_URI);

    const expected = encodeQrMatrix(SAMPLE_URI);
    const decoded = moduleGridFromMfaQrSvg(svg, expected.length);
    assert.ok(moduleGridsEqual(decoded, expected));

    const nodes = buildMfaEnrollmentChildren(document, el, { otpauth_uri: SAMPLE_URI });
    const wrap = document.createElement("div");
    wrap.append(...nodes);
    assertEnrollmentPanelMatchesUri(wrap, SAMPLE_URI);
  });

  it("clearMfaEnrollmentUi removes QR markup from the DOM", () => {
    const box = el("div", { id: "enroll-box" });
    box.append(...buildMfaEnrollmentChildren(document, el, { otpauth_uri: SAMPLE_URI }));
    assert.ok(box.querySelector("[data-mfa-qr]"));
    clearMfaEnrollmentUi(box);
    assert.equal(box.childElementCount, 0);
    assert.equal(box.hidden, true);
    assert.equal(box.querySelector("[data-mfa-qr]"), null);
  });

  async function submitLoginForm(form: HTMLFormElement) {
    form.requestSubmit();
    await new Promise((r) => setTimeout(r, 30));
  }

  it("login flow QR and setup key match the enrollment otpauth_uri response", async () => {
    const otpauth =
      "otpauth://totp/ReqALM:test@dev.local?secret=GEZDGNBVGY3TQOJQ&issuer=ReqALM";
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: true,
          json: async () => ({
            status: "mfa_enrollment_required",
            enrollment_ticket: "ticket-abc",
            otpauth_uri: otpauth,
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ redirect: "/oauth/web/callback?code=x" }),
      };
    };
    let redirected = "";
    renderLogin("handoff-1", {
      fetchFn,
      redirect: (u) => {
        redirected = u;
      },
    });
    const form = document.getElementById("login-form") as HTMLFormElement;
    (form.querySelector('[name="username"]') as HTMLInputElement).value = "test@dev.local";
    (form.querySelector('[name="password"]') as HTMLInputElement).value = "pw";
    await submitLoginForm(form);
    const enrollBox = document.getElementById("enroll-box") as HTMLElement;
    assert.ok(enrollBox.querySelector("[data-mfa-qr]"));
    assert.equal(calls, 1);
    assertEnrollmentPanelMatchesUri(enrollBox, otpauth);

    (form.querySelector('[name="mfa_code"]') as HTMLInputElement).value = "123456";
    await submitLoginForm(form);
    assert.equal(calls, 2);
    assert.equal(enrollBox.querySelector("[data-mfa-qr]"), null);
    assert.equal(enrollBox.hidden, true);
    assert.equal(redirected, "/oauth/web/callback?code=x");
  });
});
