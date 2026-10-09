import encodeQrMatrix from "./qr-min-adapter.js";

export { encodeQrMatrix };

const QR_ARIA_LABEL = "QR code for authenticator setup";
/** ISO QR quiet zone (modules). */
export const MFA_QR_QUIET_ZONE = 4;

/**
 * @param {Document} doc
 * @param {string} otpauthUri
 * @param {{ modulePixels?: number }} [opts] integer px per module (default 4)
 */
export function createMfaQrSvg(doc, otpauthUri, opts = {}) {
  const modulePx = opts.modulePixels ?? 4;
  const matrix = encodeQrMatrix(otpauthUri);
  const n = matrix.length;
  const q = MFA_QR_QUIET_ZONE;
  const totalModules = n + 2 * q;
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
      mod.setAttribute("x", String(x + q));
      mod.setAttribute("y", String(y + q));
      mod.setAttribute("width", "1");
      mod.setAttribute("height", "1");
      mod.setAttribute("fill", "#000000");
      svg.appendChild(mod);
    }
  }
  return svg;
}

/**
 * Rebuild QR data modules (no quiet zone) from rendered SVG dark rects.
 * @param {SVGSVGElement} svg
 * @param {number} matrixSize modules per side (encoder output length)
 */
export function moduleGridFromMfaQrSvg(svg, matrixSize) {
  const q = MFA_QR_QUIET_ZONE;
  const grid = Array.from({ length: matrixSize }, () => Array(matrixSize).fill(0));
  for (const rect of svg.querySelectorAll("rect[fill='#000000']")) {
    const x = Number(rect.getAttribute("x"));
    const y = Number(rect.getAttribute("y"));
    const mx = x - q;
    const my = y - q;
    if (mx >= 0 && mx < matrixSize && my >= 0 && my < matrixSize) {
      grid[my][mx] = 1;
    }
  }
  return grid;
}

/** @param {number[][]} a @param {number[][]} b */
export function moduleGridsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let y = 0; y < a.length; y++) {
    if (a[y].length !== b[y].length) return false;
    for (let x = 0; x < a[y].length; x++) {
      if (a[y][x] !== b[y][x]) return false;
    }
  }
  return true;
}

/**
 * @param {SVGSVGElement} svg
 * @param {string} otpauthUri
 */
export function assertSvgEncodesOtpauthUri(svg, otpauthUri) {
  const expected = encodeQrMatrix(otpauthUri);
  const decoded = moduleGridFromMfaQrSvg(svg, expected.length);
  if (!moduleGridsEqual(decoded, expected)) {
    throw new Error("QR SVG module grid does not match encoder output for otpauth URI");
  }
}

export function setupKeyFromOtpauthUri(otpauthUri) {
  try {
    return new URL(otpauthUri).searchParams.get("secret") || "";
  } catch {
    return "";
  }
}

/**
 * Build enrollment panel nodes (QR + setup key + otpauth URI text). Caller appends to DOM.
 * @param {Document} doc
 * @param {(tag: string, props?: Record<string, unknown>, children?: unknown[]) => HTMLElement} el
 * @param {{ otpauth_uri: string }} data
 */
export function buildMfaEnrollmentChildren(doc, el, data) {
  const otpauthUri = data.otpauth_uri;
  const setupKey = setupKeyFromOtpauthUri(otpauthUri);
  const qrWrap = el("div", { className: "mfa-qr-wrap", "data-mfa-qr": "true" }, [
    createMfaQrSvg(doc, otpauthUri),
    el("p", { className: "muted", text: "Scan with your authenticator app, or enter the setup key below." }),
  ]);
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
