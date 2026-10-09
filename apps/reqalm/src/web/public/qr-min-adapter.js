/**
 * Hand-written bridge to vendored UMD qr-min (global QR). Browser: load /vendor/qr-min.js
 * before app modules (see index.html). Node tests: set globalThis.QR via createRequire in test setup.
 */

/** @param {string} text @returns {number[][]} */
export default function encodeQrMatrix(text) {
  const QR = globalThis.QR;
  if (typeof QR !== "function") {
    throw new Error("qr-min encoder unavailable (load vendor/qr-min.js first)");
  }
  return QR(text);
}
