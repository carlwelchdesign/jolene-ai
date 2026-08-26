import { describe, expect, it } from "vitest";

import {
  assertSameOrigin,
  RequestOriginError,
} from "../src/http/request-origin.js";

describe("local mutation origin policy", () => {
  it("permits same-origin browsers and non-browser local clients", () => {
    expect(() => assertSameOrigin({ host: "127.0.0.1:8421" })).not.toThrow();
    expect(() => assertSameOrigin({
      host: "127.0.0.1:8421",
      origin: "http://127.0.0.1:8421",
    })).not.toThrow();
  });

  it("rejects cross-origin browser mutations", () => {
    expect(() => assertSameOrigin({
      host: "127.0.0.1:8421",
      origin: "https://untrusted.example",
    })).toThrow(RequestOriginError);
    expect(() => assertSameOrigin({ origin: "null" })).toThrow(RequestOriginError);
  });
});
