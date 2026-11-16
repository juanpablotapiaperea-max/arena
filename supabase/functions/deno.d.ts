// Tipos mínimos del entorno Deno para revisar las funciones con tsc.
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};
