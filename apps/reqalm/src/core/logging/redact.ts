const SENSITIVE_KEY =
  /password|secret|token|authorization|refresh|csrf|mfa|credential|api[_-]?key/i;

/** Redact sensitive keys in structured log payloads (shallow + one nested level). */
export function redactForLog(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redactForLog);
  if (typeof value !== "object") {
    if (typeof value === "string" && value.length > 8 && /^[A-Za-z0-9._-]+$/.test(value)) {
      // Heuristic: long bearer-like strings
      if (value.includes(".") && value.split(".").length >= 3) return "[REDACTED]";
    }
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(k)) {
      out[k] = "[REDACTED]";
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redactForLog(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
