import type { IncomingHttpHeaders } from "node:http";

export function assertSameOrigin(headers: IncomingHttpHeaders): void {
  const origin = headers.origin;
  if (!origin) return;

  const host = headers.host;
  if (!host || origin !== `http://${host}`) {
    throw new RequestOriginError();
  }
}

export function assertPrivateControlHost(headers: IncomingHttpHeaders): void {
  const host = headers.host;
  if (!host) throw new RequestOriginError();

  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    throw new RequestOriginError();
  }

  if (
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    hostname !== "[::1]"
  ) {
    throw new RequestOriginError();
  }
}

export class RequestOriginError extends Error {
  constructor() {
    super("The browser request origin does not match this local control server.");
    this.name = "RequestOriginError";
  }
}
