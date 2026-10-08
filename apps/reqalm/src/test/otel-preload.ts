/**
 * Registers OpenTelemetry (including pg auto-instrumentation) before test files import `pg`.
 * Loaded via `node --import ./src/test/otel-preload.ts`.
 */
import { startTestOpenTelemetry } from "./otel-testing.js";

startTestOpenTelemetry();
