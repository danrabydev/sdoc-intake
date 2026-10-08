// @ts-nocheck
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it, beforeEach, afterEach } from "node:test";
import { JSDOM } from "jsdom";
import {
  encodeQrMatrix,
  buildMfaEnrollmentChildren,
  clearMfaEnrollmentUi,
  createMfaQrSvg,
} from "./public/mfa-enroll-ui.js";
import { renderLogin } from "./public/app.js";

const SAMPLE_URI =
  "otpauth://totp/ReqALM:sam-security@dev.local?secret=JBSWY3DPEHPK3PXP&issuer=ReqALM";
/** Golden fingerprint for SAMPLE_URI (qr-min matrix); catches wrong encoder input. */
const SAMPLE_MATRIX_SHA256 = "37011c86164605eba6fa6ba421c7e823fc4dcbc2dace3cd8bee730dc8d8172d3";

function matrixFingerprint(matrix: number[][]) {
  return createHash("sha256").update(matrix.flat().join("")).digest("hex");
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

function installDom(url = "http://localhost/login?h=handoff-1") {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url });
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  globalThis.FormData = dom.window.FormData;
  globalThis.Event = dom.window.Event;
  return dom;
}

describe("MFA enrollment QR (client-side)", () => {
  beforeEach(() => installDom());
  afterEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  it("encodeQrMatrix is deterministic and changes when otpauth payload changes", () => {
    const a = encodeQrMatrix(SAMPLE_URI);
    const b = encodeQrMatrix(SAMPLE_URI);
    assert.equal(matrixFingerprint(a), SAMPLE_MATRIX_SHA256);
    assert.equal(matrixFingerprint(b), SAMPLE_MATRIX_SHA256);
    assert.notEqual(matrixFingerprint(a), matrixFingerprint(encodeQrMatrix(`${SAMPLE_URI}&period=60`)));
    assert.ok(a.length >= 21 && a.length <= 177);
  });

  it("renders an accessible SVG QR for the enroll response without network I/O", () => {
    const networkCalls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      networkCalls.push(String(url));
      throw new Error("network forbidden during QR render");
    }) as typeof fetch;

    const svg = createMfaQrSvg(document, SAMPLE_URI);
    assert.equal(networkCalls.length, 0);
    assert.equal(svg.getAttribute("role"), "img");
    assert.equal(svg.getAttribute("aria-label"), "QR code for authenticator setup");
    assert.ok(svg.querySelector("rect[fill='#000000']"));

    const nodes = buildMfaEnrollmentChildren(document, el, { otpauth_uri: SAMPLE_URI });
    const wrap = nodes.find(
      (n) => n instanceof document.defaultView!.HTMLElement && n.dataset.mfaQr === "true",
    ) as HTMLElement;
    assert.ok(wrap);
    assert.ok(wrap.querySelector("svg.mfa-qr"));
    const keyLine = nodes.flatMap((n) => Array.from(n.querySelectorAll?.("code") ?? [])).find((c) =>
      c.textContent?.includes("JBSWY3DPEHPK3PXP"),
    );
    assert.ok(keyLine);
    const uriLine = nodes.find((n) => n.tagName === "CODE" && n.textContent === SAMPLE_URI);
    assert.ok(uriLine);

    assert.equal(matrixFingerprint(encodeQrMatrix(SAMPLE_URI)), SAMPLE_MATRIX_SHA256);
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

  it("login flow shows QR on enrollment and clears it after successful sign-in", async () => {
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

    (form.querySelector('[name="mfa_code"]') as HTMLInputElement).value = "123456";
    await submitLoginForm(form);
    assert.equal(calls, 2);
    assert.equal(enrollBox.querySelector("[data-mfa-qr]"), null);
    assert.equal(enrollBox.hidden, true);
    assert.equal(redirected, "/oauth/web/callback?code=x");
  });
});
