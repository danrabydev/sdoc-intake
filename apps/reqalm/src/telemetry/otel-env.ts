/** OTLP export enabled when endpoint is set or REQALM_OTEL_ENABLED=true. Off by default in dev. */
export function isOtelExportEnabled(): boolean {
  if (process.env.REQALM_OTEL_ENABLED === "true") return true;
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() ||
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  return Boolean(endpoint);
}
