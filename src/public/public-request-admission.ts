export type PublicRequestAdmission =
  | {
    readonly accepted: true;
    readonly release: () => void | Promise<void>;
  }
  | {
    readonly accepted: false;
    readonly status: 429 | 503;
    readonly code: "rate_limited" | "public_delegate_busy";
    readonly retryAfterSeconds: number;
  };

export interface PublicRequestAdmissionController {
  acquire(clientKey: string): PublicRequestAdmission | Promise<PublicRequestAdmission>;
}

export interface FixedWindowPublicRequestAdmissionOptions {
  readonly requestsPerWindow: number;
  readonly maxConcurrentRequests: number;
  readonly windowMilliseconds?: number;
  readonly now?: () => number;
}

interface ClientWindow {
  readonly startedAt: number;
  readonly count: number;
}

export class FixedWindowPublicRequestAdmission
  implements PublicRequestAdmissionController
{
  readonly #requestsPerWindow: number;
  readonly #maxConcurrentRequests: number;
  readonly #windowMilliseconds: number;
  readonly #now: () => number;
  readonly #clients = new Map<string, ClientWindow>();
  #inFlight = 0;

  constructor(options: FixedWindowPublicRequestAdmissionOptions) {
    if (
      !Number.isInteger(options.requestsPerWindow) ||
      options.requestsPerWindow < 1 ||
      !Number.isInteger(options.maxConcurrentRequests) ||
      options.maxConcurrentRequests < 1
    ) {
      throw new Error("Public request admission limits must be positive integers.");
    }
    const windowMilliseconds = options.windowMilliseconds ?? 60_000;
    if (!Number.isInteger(windowMilliseconds) || windowMilliseconds < 1) {
      throw new Error("Public request admission window must be a positive integer.");
    }
    this.#requestsPerWindow = options.requestsPerWindow;
    this.#maxConcurrentRequests = options.maxConcurrentRequests;
    this.#windowMilliseconds = windowMilliseconds;
    this.#now = options.now ?? Date.now;
  }

  acquire(clientKey: string): PublicRequestAdmission {
    if (this.#inFlight >= this.#maxConcurrentRequests) {
      return {
        accepted: false,
        status: 503,
        code: "public_delegate_busy",
        retryAfterSeconds: 1,
      };
    }

    const now = this.#now();
    const existing = this.#clients.get(clientKey);
    const window = !existing || now - existing.startedAt >= this.#windowMilliseconds
      ? { startedAt: now, count: 0 }
      : existing;
    if (window.count >= this.#requestsPerWindow) {
      return {
        accepted: false,
        status: 429,
        code: "rate_limited",
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(
            (this.#windowMilliseconds - (now - window.startedAt)) / 1_000,
          ),
        ),
      };
    }

    this.#clients.set(clientKey, {
      startedAt: window.startedAt,
      count: window.count + 1,
    });
    this.#inFlight += 1;
    let released = false;
    return {
      accepted: true,
      release: () => {
        if (released) return;
        released = true;
        this.#inFlight -= 1;
      },
    };
  }
}
