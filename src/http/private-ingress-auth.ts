import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

import { z } from "zod";

import type { ChatRequest } from "../application/jolene-service.js";
import { assertPrivateControlHost, assertSameOrigin } from "./request-origin.js";

export const PRIVATE_CONTROL_AUTH_SCHEME = "JolenePrivateV1";
export const PRIVATE_CONTROL_AUTH_POLICY_VERSION = "jolene.private-control-auth.v1";

export const privateControlTokenSchema = z.string()
  .min(43)
  .max(512)
  .regex(/^\S+$/, "The private control token must be one nonempty line without whitespace.");

const privateIngressPrincipalSchema = z.object({
  authenticationScheme: z.literal(PRIVATE_CONTROL_AUTH_SCHEME),
  actorId: z.string().trim().min(1).max(120),
  workspaceId: z.string().trim().min(1).max(120),
  channelKind: z.literal("private_chat"),
  disclosureScope: z.literal("local_private"),
}).strict();

const privateHttpChatInputSchema = z.object({
  eventId: z.string().trim().min(1).max(240),
  channelId: z.string().trim().min(1).max(240),
  threadId: z.string().trim().min(1).max(240),
  taskId: z.string().uuid().optional(),
  includeSensitiveMemory: z.boolean().optional(),
  message: z.string().trim().min(1).max(40_000),
}).strict();

export type PrivateIngressPrincipal = z.infer<typeof privateIngressPrincipalSchema>;

export type PrivateIngressAuthenticationFailureCode =
  | "credential_missing"
  | "credential_malformed"
  | "credential_mismatch";

export class PrivateIngressAuthenticationError extends Error {
  constructor(readonly code: PrivateIngressAuthenticationFailureCode) {
    super("Private control authentication failed.");
    this.name = "PrivateIngressAuthenticationError";
  }
}

export interface PrivateIngressAuthenticatorOptions {
  readonly token: string;
  readonly ownerActorId: string;
  readonly ownerWorkspaceId: string;
  readonly audit?: (event: PrivateIngressAuthenticationEvent) => void;
}

export interface PrivateIngressAuthenticationEvent {
  readonly policyVersion: typeof PRIVATE_CONTROL_AUTH_POLICY_VERSION;
  readonly outcome: "authorized" | "denied";
  readonly reasonCode:
    | PrivateIngressAuthenticationFailureCode
    | "credential_accepted_bearer"
    | "credential_accepted_basic";
}

export interface PrivateControlRequestGuard {
  authorize(headers: IncomingHttpHeaders): PrivateIngressPrincipal;
}

export interface PrivateIngressAuthenticator {
  authenticate(headers: IncomingHttpHeaders): PrivateIngressPrincipal;
}

export function createPrivateIngressAuthenticator(
  options: PrivateIngressAuthenticatorOptions,
): PrivateIngressAuthenticator {
  const token = privateControlTokenSchema.parse(options.token);
  const principal = Object.freeze(privateIngressPrincipalSchema.parse({
    authenticationScheme: PRIVATE_CONTROL_AUTH_SCHEME,
    actorId: options.ownerActorId,
    workspaceId: options.ownerWorkspaceId,
    channelKind: "private_chat",
    disclosureScope: "local_private",
  }));

  return Object.freeze({
    authenticate(headers: IncomingHttpHeaders): PrivateIngressPrincipal {
      try {
        const candidate = parseAuthorization(headers.authorization);
        if (!constantTimeEqual(candidate.token, token)) {
          throw new PrivateIngressAuthenticationError("credential_mismatch");
        }
        options.audit?.({
          policyVersion: PRIVATE_CONTROL_AUTH_POLICY_VERSION,
          outcome: "authorized",
          reasonCode: candidate.method === "bearer"
            ? "credential_accepted_bearer"
            : "credential_accepted_basic",
        });
        return principal;
      } catch (error) {
        if (error instanceof PrivateIngressAuthenticationError) {
          options.audit?.({
            policyVersion: PRIVATE_CONTROL_AUTH_POLICY_VERSION,
            outcome: "denied",
            reasonCode: error.code,
          });
        }
        throw error;
      }
    },
  });
}

export function createPrivateControlRequestGuard(
  options: PrivateIngressAuthenticatorOptions,
): PrivateControlRequestGuard {
  const authenticator = createPrivateIngressAuthenticator(options);
  return Object.freeze({
    authorize(headers: IncomingHttpHeaders): PrivateIngressPrincipal {
      assertPrivateControlHost(headers);
      assertSameOrigin(headers);
      return authenticator.authenticate(headers);
    },
  });
}

export function derivePrivateHttpChatRequest(
  input: unknown,
  principal: PrivateIngressPrincipal,
): ChatRequest {
  const parsedPrincipal = privateIngressPrincipalSchema.parse(principal);
  const parsedInput = privateHttpChatInputSchema.parse(input);
  return {
    ...parsedInput,
    actorId: parsedPrincipal.actorId,
    workspaceId: parsedPrincipal.workspaceId,
    channelKind: parsedPrincipal.channelKind,
  };
}

function parseAuthorization(
  header: string | undefined,
): { readonly token: string; readonly method: "bearer" | "basic" } {
  if (!header) {
    throw new PrivateIngressAuthenticationError("credential_missing");
  }
  const parts = header.split(" ");
  if (parts.length !== 2 || !parts[1]) {
    throw new PrivateIngressAuthenticationError("credential_malformed");
  }
  if (parts[0] === "Bearer") return { token: parts[1], method: "bearer" };
  if (parts[0] !== "Basic") {
    throw new PrivateIngressAuthenticationError("credential_malformed");
  }

  let decoded: string;
  try {
    decoded = Buffer.from(parts[1], "base64").toString("utf8");
  } catch {
    throw new PrivateIngressAuthenticationError("credential_malformed");
  }
  const separator = decoded.indexOf(":");
  if (separator < 0 || decoded.slice(0, separator) !== "jolene") {
    throw new PrivateIngressAuthenticationError("credential_malformed");
  }
  return { token: decoded.slice(separator + 1), method: "basic" };
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  if (leftBytes.length !== rightBytes.length) {
    timingSafeEqual(rightBytes, rightBytes);
    return false;
  }
  return timingSafeEqual(leftBytes, rightBytes);
}
