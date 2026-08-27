import type { Server } from "node:http";

export interface PublicServerShutdownResult {
  readonly forced: boolean;
  readonly serverCount: number;
}

export async function closePublicServers(
  servers: readonly Server[],
  timeoutMilliseconds = 5_000,
): Promise<PublicServerShutdownResult> {
  if (
    !Number.isInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 100 ||
    timeoutMilliseconds > 30_000
  ) {
    throw new Error("Public server shutdown timeout must be 100-30000ms.");
  }
  const listening = servers.filter((server) => server.listening);
  if (listening.length === 0) return { forced: false, serverCount: 0 };

  listening.forEach((server) => server.closeIdleConnections());
  let forced = false;
  const closing = Promise.all(listening.map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
  const timeout = setTimeout(() => {
    forced = true;
    listening.forEach((server) => server.closeAllConnections());
  }, timeoutMilliseconds);
  timeout.unref();
  await closing;
  clearTimeout(timeout);
  return { forced, serverCount: listening.length };
}
