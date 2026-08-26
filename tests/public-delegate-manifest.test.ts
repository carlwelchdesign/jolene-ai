import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FilePublicArtifactSource } from "../src/public/public-artifact-source.js";
import {
  parsePublicDelegateConfig,
} from "../src/public/public-config.js";
import {
  createPublicDelegateServer,
} from "../src/public/public-delegate-server.js";

const temporaryDirectories: string[] = [];
const openServers: ReturnType<typeof createPublicDelegateServer>[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => close(server)));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

describe("public delegate manifest boundary", () => {
  it("loads public-only defaults without requiring private credentials", () => {
    const config = parsePublicDelegateConfig({
      OPENAI_API_KEY: undefined,
      SLACK_BOT_TOKEN: undefined,
      JOLENE_DATABASE_PATH: undefined,
    });
    expect(() => parsePublicDelegateConfig({
      JOLENE_PUBLIC_HOST: "0.0.0.0",
    })).toThrow();

    expect(config).toEqual({
      host: "127.0.0.1",
      port: 8431,
      artifactPath: path.resolve(
        ".jolene/exports/public-career-evidence.json",
      ),
    });
  });

  it("serves the exact frozen v1 manifest with no-store security headers", async () => {
    const fixture = await loadFixture();
    const { baseUrl } = await start(await writeArtifact(fixture));

    const response = await fetch(`${baseUrl}/v1/public-evidence/manifest`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(fixture.manifest);
    expect(Object.keys(body as Record<string, unknown>).sort()).toEqual([
      "corpusHash",
      "corpusVersion",
      "evidenceCount",
      "generatedAt",
      "reviewedAt",
      "revokedEvidenceIds",
      "schemaVersion",
    ]);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy"))
      .toBe("default-src 'none'; frame-ancestors 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(JSON.stringify(body)).not.toContain("/Users/");
  });

  it("reports only public corpus health", async () => {
    const fixture = await loadFixture();
    const { baseUrl } = await start(await writeArtifact(fixture));

    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      schemaVersion: fixture.manifest.schemaVersion,
      corpusVersion: fixture.manifest.corpusVersion,
      evidenceCount: 0,
    });
  });

  it.each([
    "missing",
    "malformed",
    "schema_mismatch",
    "hash_mismatch",
  ] as const)(
    "fails closed for a %s artifact without disclosing details",
    async (scenario) => {
      const fixture = await loadFixture();
      const artifactPath = scenario === "missing"
        ? path.join(await temporaryDirectory(), "missing.json")
        : scenario === "malformed"
          ? await writeArtifact("{not-json")
          : scenario === "schema_mismatch"
            ? await writeArtifact({
                ...fixture,
                manifest: { ...fixture.manifest, schemaVersion: "2.0.0" },
              })
            : await writeArtifact({
                ...fixture,
                manifest: {
                  ...fixture.manifest,
                  corpusHash: `sha256:${"0".repeat(64)}`,
                  corpusVersion: `career:${"0".repeat(64)}`,
                },
              });
      const { baseUrl } = await start(artifactPath);

      const response = await fetch(`${baseUrl}/v1/public-evidence/manifest`);
      const responseText = await response.text();

      expect(response.status).toBe(503);
      expect(JSON.parse(responseText)).toEqual({
        status: "unavailable",
        error: "public_evidence_unavailable",
      });
      expect(responseText).not.toContain(artifactPath);
    },
  );

  it("rejects unsupported methods and unknown routes without reading evidence", async () => {
    const { baseUrl } = await start(
      path.join(await temporaryDirectory(), "missing.json"),
    );

    const method = await fetch(`${baseUrl}/v1/public-evidence/manifest`, {
      method: "POST",
    });
    const unknown = await fetch(`${baseUrl}/v1/private-memory`);

    expect(method.status).toBe(405);
    expect(method.headers.get("allow")).toBe("GET");
    expect(await method.json()).toEqual({ error: "method_not_allowed" });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "not_found" });
  });

  it("bounds request URLs before reading evidence", async () => {
    const { baseUrl } = await start(
      path.join(await temporaryDirectory(), "missing.json"),
    );

    const response = await fetch(`${baseUrl}/${"x".repeat(2_100)}`);

    expect(response.status).toBe(414);
    expect(await response.json()).toEqual({ error: "uri_too_long" });
  });

  it("reloads and validates the artifact for each request", async () => {
    const fixture = await loadFixture();
    const artifactPath = await writeArtifact(fixture);
    const { baseUrl } = await start(artifactPath);

    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
    await writeFile(artifactPath, "{invalid", "utf8");

    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "unavailable",
      error: "public_evidence_unavailable",
    });
  });

  it("keeps the public entrypoint free of private runtime imports", async () => {
    const files = [
      "src/public-server.ts",
      "src/public/public-config.ts",
      "src/public/public-artifact-source.ts",
      "src/public/public-delegate-server.ts",
    ];
    const source = (await Promise.all(
      files.map((file) => readFile(path.resolve(file), "utf8")),
    )).join("\n");

    for (const forbidden of [
      "./app.js",
      "../config.js",
      "/persistence/",
      "/knowledge/",
      "/slack/",
      "sqlite",
      "obsidian",
      "OPENAI_API_KEY",
    ]) {
      expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

async function loadFixture() {
  return JSON.parse(
    await readFile(
      path.resolve("contracts/fixtures/public-career-evidence-empty.json"),
      "utf8",
    ),
  ) as {
    readonly manifest: Record<string, unknown>;
    readonly evidence: readonly unknown[];
  };
}

async function writeArtifact(value: unknown): Promise<string> {
  const artifactPath = path.join(await temporaryDirectory(), "artifact.json");
  await writeFile(
    artifactPath,
    typeof value === "string" ? value : JSON.stringify(value),
    "utf8",
  );
  return artifactPath;
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "jolene-public-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function start(artifactPath: string): Promise<{ readonly baseUrl: string }> {
  const server = createPublicDelegateServer({
    artifacts: new FilePublicArtifactSource(artifactPath),
  });
  openServers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected an ephemeral TCP address.");
  }
  return { baseUrl: `http://127.0.0.1:${address.port}` };
}

async function close(server: ReturnType<typeof createPublicDelegateServer>) {
  if (!server.listening) return;
  server.close();
  await once(server, "close");
}
