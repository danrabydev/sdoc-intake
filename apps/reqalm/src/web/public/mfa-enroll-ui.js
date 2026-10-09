import encodeQrMatrix from "./qr-min-adapter.js";

const QR_ARIA_LABEL = "QR code for authenticator setup";

/**
 * @param {Document} doc
 * @param {string} otpauthUri
 * @param {{ modulePixels?: number }} [opts] integer px per module (default 4)
 */
export function createMfaQrSvg(doc, otpauthUri, opts = {}) {
  const modulePx = opts.modulePixels ?? 4;
  const matrix = encodeQrMatrix(otpauthUri);
  const n = matrix.length;
  const quiet = 4;
  const totalModules = n + 2 * quiet;
  const sizePx = totalModules * modulePx;
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "mfa-qr");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", QR_ARIA_LABEL);
  svg.setAttribute("width", String(sizePx));
  svg.setAttribute("height", String(sizePx));
  svg.setAttribute("viewBox", `0 0 ${totalModules} ${totalModules}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  const bg = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("x", "0");
  bg.setAttribute("y", "0");
  bg.setAttribute("width", String(totalModules));
  bg.setAttribute("height", String(totalModules));
  bg.setAttribute("fill", "#ffffff");
  svg.appendChild(bg);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!matrix[y][x]) continue;
      const mod = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
      mod.setAttribute("x", String(x + quiet));
      mod.setAttribute("y", String(y + quiet));
      mod.setAttribute("width", "1");
      mod.setAttribute("height", "1");
      mod.setAttribute("fill", "#000000");
      svg.appendChild(mod);
    }
  }
  return svg;
}

function setupKeyFromOtpauthUri(otpauthUri) {
  try {
    return new URL(otpauthUri).searchParams.get("secret") || "";
  } catch {
    return "";
  }
}

/**
 * Build enrollment panel nodes (QR + setup key + otpauth URI text). Caller appends to DOM.
 * QR failure must not block setup key, URI, or MFA entry (handled in app.js).
 * @param {Document} doc
 * @param {(tag: string, props?: Record<string, unknown>, children?: unknown[]) => HTMLElement} el
 * @param {{ otpauth_uri: string }} data
 */
export function buildMfaEnrollmentChildren(doc, el, data) {
  const otpauthUri = data.otpauth_uri;
  const setupKey = setupKeyFromOtpauthUri(otpauthUri);
  const qrInner = [];
  try {
    qrInner.push(createMfaQrSvg(doc, otpauthUri));
    qrInner.push(
      el("p", { className: "muted", text: "Scan with your authenticator app, or enter the setup key below." }),
    );
  } catch {
    qrInner.push(
      el("p", {
        className: "muted",
        text: "QR code unavailable; enter the setup key or manual URI below in your authenticator app.",
      }),
    );
  }
  const qrWrap = el("div", { className: "mfa-qr-wrap", "data-mfa-qr": "true" }, qrInner);
  return [
    el("p", {
      className: "muted",
      text: "Add this account to your authenticator app (scan the QR code or enter the setup key), then enter the 6-digit code:",
    }),
    qrWrap,
    el("p", { id: "mfa-setup-key-line" }, [doc.createTextNode("Setup key: "), el("code", { id: "mfa-setup-key", text: setupKey })]),
    el("p", { className: "muted", text: "Manual entry URI:" }),
    el("code", { id: "mfa-otpauth-uri", text: otpauthUri }),
  ];
}

/** Remove QR and enrollment copy from the DOM (secrets must not linger after enrollment). */
export function clearMfaEnrollmentUi(enrollBox) {
  if (!enrollBox) return;
  enrollBox.replaceChildren();
  enrollBox.hidden = true;
}
