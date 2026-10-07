/** OTLP export enabled when endpoint is set or REQALM_OTEL_ENABLED=true. Off by default in dev. */
export function isOtelExportEnabled(): boolean {
  if (process.env.REQALM_OTEL_ENABLED === "true") return true;
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  return Boolean(endpoint);
}

/** Manual spans + log correlation — on whenever export is enabled or tests force memory mode. */
export function isOtelTracingActive(): boolean {
  if (process.env.REQALM_OTEL_DISABLE === "true") return false;
  if (process.env.REQALM_OTEL_TEST_MEMORY === "true") return true;
  return isOtelExportEnabled();
}

export function serviceNameFromEnv(): string {
  return process.env.OTEL_SERVICE_NAME?.trim() || "reqalm";
}
