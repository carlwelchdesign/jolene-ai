import type { IncomingHttpHeaders } from "node:http";

export function assertSameOrigin(headers: IncomingHttpHeaders): void {
  const origin = headers.origin;
  if (!origin) return;

  const host = headers.host;
  if (!host || origin !== `http://${host}`) {
    throw new RequestOriginError();
  }
}

export class RequestOriginError extends Error {
  constructor() {
    super("The browser request origin does not match this local control server.");
    this.name = "RequestOriginError";
  }
}
