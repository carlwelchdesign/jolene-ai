import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

import { z } from "zod";

import type { ChatRequest } from "../application/jolene-service.js";

export const PRIVATE_CONTROL_AUTH_SCHEME = "JolenePrivateV1";

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
      const candidate = parseAuthorization(headers.authorization);
      if (!constantTimeEqual(candidate, token)) {
        throw new PrivateIngressAuthenticationError("credential_mismatch");
      }
      return principal;
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

function parseAuthorization(header: string | undefined): string {
  if (!header) {
    throw new PrivateIngressAuthenticationError("credential_missing");
  }
  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
    throw new PrivateIngressAuthenticationError("credential_malformed");
  }
  return parts[1];
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
