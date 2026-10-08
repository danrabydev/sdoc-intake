import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

/** Printable ASCII (no control chars), max 128 — W3C / gateway friendly. */
const REQUEST_ID_RE = /^[\x21-\x7E]{1,128}$/;

export function normalizeRequestId(raw: string | undefined): string {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (REQUEST_ID_RE.test(trimmed)) return trimmed;
  }
  return randomUUID();
}

export function requestIdFromHeaders(headers: IncomingHttpHeaders): string {
  const header = headers["x-request-id"];
  const raw = typeof header === "string" ? header : Array.isArray(header) ? header[0] : undefined;
  return normalizeRequestId(raw);
}
