import fastifyOtelModule from "@fastify/otel";
import type { Span } from "@opentelemetry/api";
import { ATTR_URL_PATH } from "@opentelemetry/semantic-conventions";
import type { FastifyRequest } from "fastify";

type FastifyOtelOptions = {
  registerOnInitialization?: boolean;
  requestHook?: (span: Span, request: FastifyRequest) => void;
};

type FastifyOtelCtor = new (opts?: FastifyOtelOptions) => {
  setTracerProvider: (provider: unknown) => void;
};

const FastifyOtelInstrumentation = fastifyOtelModule as unknown as FastifyOtelCtor;

let fastifyOtel: InstanceType<FastifyOtelCtor> | null = null;

export function getFastifyOtelInstrumentation(): InstanceType<FastifyOtelCtor> {
  if (!fastifyOtel) {
    fastifyOtel = new FastifyOtelInstrumentation({
      registerOnInitialization: true,
      // @fastify/otel puts the raw request URL (query included, e.g. an OAuth `code`) into
      // url.path; keep only the path. The http server span carries the redacted url.query.
      requestHook: (span, request) => {
        span.setAttribute(ATTR_URL_PATH, request.url.split("?")[0] ?? "");
      },
    });
  }
  return fastifyOtel;
}
