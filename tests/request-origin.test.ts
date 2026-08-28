import { describe, expect, it } from "vitest";

import {
  assertPrivateControlHost,
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

describe("private control host policy", () => {
  it.each(["127.0.0.1:8421", "localhost:8421", "[::1]:8421"])(
    "accepts loopback host %s",
    (host) => expect(() => assertPrivateControlHost({ host })).not.toThrow(),
  );

  it.each(["0.0.0.0:8421", "192.168.1.4:8421", "jolene.internal:8421", "bad host"])(
    "rejects non-loopback or malformed host %s",
    (host) => expect(() => assertPrivateControlHost({ host })).toThrow(RequestOriginError),
  );

  it("rejects a missing host", () => {
    expect(() => assertPrivateControlHost({})).toThrow(RequestOriginError);
  });
});
