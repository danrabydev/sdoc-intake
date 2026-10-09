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
  buildMfaEnrollmentChildren,
  clearMfaEnrollmentUi,
  createMfaQrSvg,
} from "./public/mfa-enroll-ui.js";
import { renderLogin } from "./public/app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = path.join(__dirname, "public/index.html");
const VENDOR_QR_MIN = path.join(__dirname, "public/vendor/qr-min.js");
const VENDOR_QR_MIN_SHA256 = "0bebad1a102e61131ba2988d75985234395c187127dff724c2125cc75e868ac8";

const SAMPLE_URI =
  "otpauth://totp/ReqALM:sam-security@dev.local?secret=JBSWY3DPEHPK3PXP&issuer=ReqALM";
const SAMPLE_SECRET = "JBSWY3DPEHPK3PXP";
/** Golden grid fingerprint for SAMPLE_URI via vendored qr-min (independent of qr-min-adapter.js). */
const SAMPLE_MATRIX_SHA256 = "37011c86164605eba6fa6ba421c7e823fc4dcbc2dace3cd8bee730dc8d8172d3";

const LOGIN_OTPAUTH =
  "otpauth://totp/ReqALM:test@dev.local?secret=GEZDGNBVGY3TQOJQ&issuer=ReqALM";
const LOGIN_SECRET = "GEZDGNBVGY3TQOJQ";

function vendoredEncodeQr(text: string): number[][] {
  const require = createRequire(import.meta.url);
  const QR = require("./public/vendor/qr-min.js");
  return QR(text);
}

function matrixFingerprint(matrix: number[][]) {
  return createHash("sha256").update(matrix.flat().join("")).digest("hex");
}

function moduleGridFromMfaQrSvg(svg: SVGSVGElement, matrixSize: number) {
  const quiet = 4;
  const grid = Array.from({ length: matrixSize }, () => Array(matrixSize).fill(0));
  for (const rect of svg.querySelectorAll("rect[fill='#000000']")) {
    const x = Number(rect.getAttribute("x"));
    const y = Number(rect.getAttribute("y"));
    assert.ok(x >= quiet && y >= quiet, "dark modules must sit inside 4-module quiet zone");
    const mx = x - quiet;
    const my = y - quiet;
    if (mx >= 0 && mx < matrixSize && my >= 0 && my < matrixSize) {
      grid[my][mx] = 1;
    }
  }
  return grid;
}

function moduleGridsEqual(a: number[][], b: number[][]) {
  if (a.length !== b.length) return false;
  for (let y = 0; y < a.length; y++) {
    if (a[y].length !== b[y].length) return false;
    for (let x = 0; x < a[y].length; x++) {
      if (a[y][x] !== b[y][x]) return false;
    }
  }
  return true;
}

/** Compare SVG to vendored encoder only — not qr-min-adapter.js. */
function assertSvgMatchesVendoredEncoder(svg: SVGSVGElement, otpauthUri: string, goldenSha256?: string) {
  const expected = vendoredEncodeQr(otpauthUri);
  const decoded = moduleGridFromMfaQrSvg(svg, expected.length);
  assert.ok(moduleGridsEqual(decoded, expected), "SVG grid must match vendored qr-min output");
  if (goldenSha256) {
    assert.equal(matrixFingerprint(decoded), goldenSha256);
  }
}

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

function assertEnrollmentTextFallback(enrollRoot: ParentNode, otpauthUri: string, expectedSecret: string) {
  assert.equal(enrollRoot.querySelector("#mfa-setup-key")?.textContent, expectedSecret);
  assert.equal(enrollRoot.querySelector("#mfa-otpauth-uri")?.textContent, otpauthUri);
}

function assertEnrollmentPanelWithQr(
  enrollRoot: ParentNode,
  otpauthUri: string,
  expectedSecret: string,
  goldenSha256?: string,
) {
  const svg = enrollRoot.querySelector("svg.mfa-qr") as SVGSVGElement | null;
  assert.ok(svg, "expected MFA QR svg");
  assertSvgMatchesVendoredEncoder(svg, otpauthUri, goldenSha256);
  assertEnrollmentTextFallback(enrollRoot, otpauthUri, expectedSecret);
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

  it("renders SVG whose modules match vendored encoder and golden fingerprint", () => {
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
    assertSvgMatchesVendoredEncoder(svg, SAMPLE_URI, SAMPLE_MATRIX_SHA256);
    const n = vendoredEncodeQr(SAMPLE_URI).length;
    assert.equal(svg.getAttribute("viewBox"), `0 0 ${n + 8} ${n + 8}`);

    const nodes = buildMfaEnrollmentChildren(document, el, { otpauth_uri: SAMPLE_URI });
    const wrap = document.createElement("div");
    wrap.append(...nodes);
    assertEnrollmentPanelWithQr(wrap, SAMPLE_URI, SAMPLE_SECRET, SAMPLE_MATRIX_SHA256);
  });

  it("shows setup key and URI when vendored encoder is not loaded", () => {
    delete (globalThis as { QR?: unknown }).QR;
    const nodes = buildMfaEnrollmentChildren(document, el, { otpauth_uri: SAMPLE_URI });
    const wrap = document.createElement("div");
    wrap.append(...nodes);
    assert.equal(wrap.querySelector("svg.mfa-qr"), null);
    assertEnrollmentTextFallback(wrap, SAMPLE_URI, SAMPLE_SECRET);
  });

  it("shows setup key and URI when encoder throws", () => {
    globalThis.QR = () => {
      throw new Error("encoder failed");
    };
    const nodes = buildMfaEnrollmentChildren(document, el, { otpauth_uri: SAMPLE_URI });
    const wrap = document.createElement("div");
    wrap.append(...nodes);
    assert.equal(wrap.querySelector("svg.mfa-qr"), null);
    assert.match(wrap.textContent ?? "", /QR code unavailable/);
    assertEnrollmentTextFallback(wrap, SAMPLE_URI, SAMPLE_SECRET);
  });

  it("index.html loads vendor qr-min before the app module script", () => {
    const html = readFileSync(INDEX_HTML, "utf8");
    const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*>/gi)].map((m) => m[1]);
    assert.deepEqual(scripts, ["/vendor/qr-min.js", "/app.js"]);
    assert.match(html, /<script src="\/vendor\/qr-min\.js"><\/script>\s*\n\s*<script type="module" src="\/app\.js"><\/script>/);
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
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: true,
          json: async () => ({
            status: "mfa_enrollment_required",
            enrollment_ticket: "ticket-abc",
            otpauth_uri: LOGIN_OTPAUTH,
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
    assertEnrollmentPanelWithQr(enrollBox, LOGIN_OTPAUTH, LOGIN_SECRET);
    assert.equal(document.getElementById("mfa-wrap")?.hidden, false);

    (form.querySelector('[name="mfa_code"]') as HTMLInputElement).value = "123456";
    await submitLoginForm(form);
    assert.equal(calls, 2);
    assert.equal(enrollBox.querySelector("[data-mfa-qr]"), null);
    assert.equal(enrollBox.hidden, true);
    assert.equal(redirected, "/oauth/web/callback?code=x");
  });

  it("login enrollment keeps QR after invalid MFA, resends ticket, clears on success", async () => {
    const ticket = "ticket-enroll-xyz";
    const bodies: Record<string, unknown>[] = [];
    let calls = 0;
    const fetchFn = async (_url: string, init?: RequestInit) => {
      calls += 1;
      bodies.push(JSON.parse(String(init?.body)));
      if (calls === 1) {
        return {
          ok: true,
          json: async () => ({
            status: "mfa_enrollment_required",
            enrollment_ticket: ticket,
            otpauth_uri: LOGIN_OTPAUTH,
          }),
        };
      }
      if (calls === 2) {
        return { ok: false, status: 401, json: async () => ({ error: "invalid_mfa" }) };
      }
      return { ok: true, json: async () => ({ redirect: "/oauth/web/callback?code=ok" }) };
    };
    let redirected = "";
    renderLogin("handoff-1", { fetchFn, redirect: (u) => {
      redirected = u;
    } });
    const form = document.getElementById("login-form") as HTMLFormElement;
    const err = document.getElementById("error") as HTMLElement;
    (form.querySelector('[name="username"]') as HTMLInputElement).value = "test@dev.local";
    (form.querySelector('[name="password"]') as HTMLInputElement).value = "pw";
    await submitLoginForm(form);
    const enrollBox = document.getElementById("enroll-box") as HTMLElement;
    assertEnrollmentPanelWithQr(enrollBox, LOGIN_OTPAUTH, LOGIN_SECRET);

    (form.querySelector('[name="mfa_code"]') as HTMLInputElement).value = "000000";
    await submitLoginForm(form);
    assert.equal(calls, 2);
    assert.equal(err.hidden, false);
    assert.equal(err.textContent, "invalid_mfa");
    assert.ok(enrollBox.querySelector("svg.mfa-qr"));
    assert.equal(enrollBox.querySelector("#mfa-setup-key")?.textContent, LOGIN_SECRET);
    assert.equal(bodies[1]?.enrollment_ticket, ticket);

    (form.querySelector('[name="mfa_code"]') as HTMLInputElement).value = "123456";
    await submitLoginForm(form);
    assert.equal(calls, 3);
    assert.equal(bodies[2]?.enrollment_ticket, ticket);
    assert.equal(enrollBox.hidden, true);
    assert.equal(enrollBox.childElementCount, 0);
    assert.equal(redirected, "/oauth/web/callback?code=ok");
  });

  it("login enrollment still shows setup key when encoder is missing", async () => {
    delete (globalThis as { QR?: unknown }).QR;
    let calls = 0;
    const fetchFn = async () => ({
      ok: true,
      json: async () => {
        calls += 1;
        return {
          status: "mfa_enrollment_required",
          enrollment_ticket: "t",
          otpauth_uri: LOGIN_OTPAUTH,
        };
      },
    });
    renderLogin("handoff-1", { fetchFn, redirect: () => {} });
    const form = document.getElementById("login-form") as HTMLFormElement;
    (form.querySelector('[name="username"]') as HTMLInputElement).value = "u";
    (form.querySelector('[name="password"]') as HTMLInputElement).value = "p";
    await submitLoginForm(form);
    const enrollBox = document.getElementById("enroll-box") as HTMLElement;
    assert.equal(enrollBox.querySelector("svg.mfa-qr"), null);
    assertEnrollmentTextFallback(enrollBox, LOGIN_OTPAUTH, LOGIN_SECRET);
    assert.equal(document.getElementById("mfa-wrap")?.hidden, false);
    assert.equal(calls, 1);
  });
});
