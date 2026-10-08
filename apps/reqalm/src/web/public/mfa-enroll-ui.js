import encodeQrMatrix from "./vendor/qr-min.js";

export { encodeQrMatrix };

const QR_ARIA_LABEL = "QR code for authenticator setup";

/**
 * @param {Document} doc
 * @param {string} otpauthUri
 * @param {{ size?: number }} [opts]
 */
export function createMfaQrSvg(doc, otpauthUri, opts = {}) {
  const size = opts.size ?? 200;
  const matrix = encodeQrMatrix(otpauthUri);
  const n = matrix.length;
  const cell = size / n;
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "mfa-qr");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", QR_ARIA_LABEL);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  const bg = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", String(size));
  bg.setAttribute("height", String(size));
  bg.setAttribute("fill", "#ffffff");
  svg.appendChild(bg);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!matrix[y][x]) continue;
      const mod = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
      mod.setAttribute("x", String(x * cell));
      mod.setAttribute("y", String(y * cell));
      mod.setAttribute("width", String(cell));
      mod.setAttribute("height", String(cell));
      mod.setAttribute("fill", "#000000");
      svg.appendChild(mod);
    }
  }
  return svg;
}

/**
 * Build enrollment panel nodes (QR + setup key + otpauth URI text). Caller appends to DOM.
 * @param {Document} doc
 * @param {(tag: string, props?: Record<string, unknown>, children?: unknown[]) => HTMLElement} el
 * @param {{ otpauth_uri: string }} data
 */
export function buildMfaEnrollmentChildren(doc, el, data) {
  const otpauthUri = data.otpauth_uri;
  let setupKey = "";
  try {
    setupKey = new URL(otpauthUri).searchParams.get("secret") || "";
  } catch {
    setupKey = "";
  }
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
    el("p", {}, [doc.createTextNode("Setup key: "), el("code", { text: setupKey })]),
    el("p", { className: "muted", text: "Manual entry URI:" }),
    el("code", { text: otpauthUri }),
  ];
}

/** Remove QR and enrollment copy from the DOM (secrets must not linger after enrollment). */
export function clearMfaEnrollmentUi(enrollBox) {
  if (!enrollBox) return;
  enrollBox.replaceChildren();
  enrollBox.hidden = true;
}
