// eslint-disable-next-line @typescript-eslint/no-require-imports
import fastifyOtelModule from "@fastify/otel";

type FastifyOtelCtor = new (opts?: { registerOnInitialization?: boolean }) => {
  setTracerProvider: (provider: unknown) => void;
};

const FastifyOtelInstrumentation = fastifyOtelModule as unknown as FastifyOtelCtor;

let fastifyOtel: InstanceType<FastifyOtelCtor> | null = null;

export function getFastifyOtelInstrumentation(): InstanceType<FastifyOtelCtor> {
  if (!fastifyOtel) {
    fastifyOtel = new FastifyOtelInstrumentation({ registerOnInitialization: true });
  }
  return fastifyOtel;
}
