import {
  PRIVATE_RAG_POLICY_VERSION,
  evaluatePrivateRagIngress,
  privateRagTurnPolicySchema,
  type PrivateRagNamespace,
  type PrivateRagProviderPayloadClass,
  type PrivateRagRiskSignal,
  type PrivateRagTurnPolicy,
} from "../domain/private-rag-policy.js";
import {
  serializeUntrustedContentEnvelope,
  type UntrustedContentClassification,
  type UntrustedContentEnvelope,
  type UntrustedContentOriginKind,
} from "../domain/untrusted-content.js";
import type { AgentRequest } from "../agent/agent-runner.js";

export type PrivateRetrievalProviderEgress = "local_only" | "approved_openai";

export interface PrivateRagProviderEntry {
  readonly namespace: PrivateRagNamespace;
  readonly envelope: UntrustedContentEnvelope;
  readonly providerPayloadClass: PrivateRagProviderPayloadClass;
}

export interface PrivateRagQuarantineCandidate {
  readonly parentFingerprint: string;
  readonly taintIds: readonly string[];
  readonly riskSignals: readonly PrivateRagRiskSignal[];
}

export interface PrivateRagProviderGateResult {
  readonly providerEnvelopes: readonly UntrustedContentEnvelope[];
  readonly quarantineCandidates: readonly PrivateRagQuarantineCandidate[];
  readonly localResultCount: number;
  readonly fallbackReason:
    | "provider_egress_not_authorized"
    | "all_results_quarantined"
    | "all_results_denied"
    | null;
}

export function createPrivateRagTurnPolicy(input: {
  readonly request: AgentRequest;
  readonly currentIntentFingerprint: string;
  readonly namespaces: readonly PrivateRagNamespace[];
  readonly origins: readonly UntrustedContentOriginKind[];
  readonly classifications: readonly UntrustedContentClassification[];
  readonly maxQueryTerms: number;
  readonly maxResultItems: number;
  readonly maxResultCharacters: number;
  readonly providerEgress: PrivateRetrievalProviderEgress;
  readonly providerPayloadClasses: readonly PrivateRagProviderPayloadClass[];
}): PrivateRagTurnPolicy {
  return privateRagTurnPolicySchema.parse({
    version: PRIVATE_RAG_POLICY_VERSION,
    eventId: input.request.eventId,
    principal: {
      actorId: input.request.actorId,
      workspaceId: input.request.workspaceId,
      verification: "authenticated_owner",
    },
    channel: {
      kind: input.request.channelKind,
      id: input.request.channelId,
      threadId: input.request.threadId,
      disclosureCeiling: "owner_only",
    },
    currentIntentFingerprint: input.currentIntentFingerprint,
    allowedNamespaces: input.namespaces,
    allowedOrigins: input.origins,
    allowedClassifications: input.classifications,
    budgets: {
      maxQueryTerms: input.maxQueryTerms,
      maxResultItems: input.maxResultItems,
      maxResultCharacters: input.maxResultCharacters,
    },
    providerEgress: input.providerEgress === "approved_openai"
      ? {
          mode: "approved_provider",
          providerId: "openai-private-agent",
          allowedPayloadClasses: input.providerPayloadClasses,
        }
      : { mode: "local_only" },
  });
}

export function gatePrivateRagProviderPayload(input: {
  readonly policy: PrivateRagTurnPolicy;
  readonly entries: readonly PrivateRagProviderEntry[];
  readonly queryTermCount: number;
  readonly blockedTaintIds?: ReadonlySet<string>;
}): PrivateRagProviderGateResult {
  const providerEnvelopes: UntrustedContentEnvelope[] = [];
  const quarantineCandidates: PrivateRagQuarantineCandidate[] = [];
  const totalCharacterCount = input.entries.reduce(
    (total, entry) =>
      total + serializeUntrustedContentEnvelope(entry.envelope).length,
    0,
  );
  const collectionRiskSignals = detectPrivateRagCollectionRiskSignals(
    input.entries.map((entry) => entry.envelope),
  );
  for (const entry of input.entries) {
    const riskSignals = new Set([
      ...detectPrivateRagRiskSignals(entry.envelope),
      ...collectionRiskSignals,
    ]);
    if (!payloadClassMatchesOrigin(entry)) {
      riskSignals.add("provider_payload_drift");
    }
    if (entry.envelope.lineage.taintIds.some((taintId) =>
      input.blockedTaintIds?.has(taintId)
    )) {
      riskSignals.add("previously_quarantined");
    }
    const orderedRiskSignals = Object.freeze([...riskSignals].sort());
    const decision = evaluatePrivateRagIngress(input.policy, {
      namespace: entry.namespace,
      envelope: entry.envelope,
      riskSignals: orderedRiskSignals,
      queryTermCount: input.queryTermCount,
      resultItemCount: input.entries.length,
      resultCharacterCount: totalCharacterCount,
      providerPayloadClass: entry.providerPayloadClass,
    });
    if (decision.localUse === "quarantine") {
      quarantineCandidates.push(Object.freeze({
        parentFingerprint: decision.parentFingerprint,
        taintIds: decision.taintIds,
        riskSignals: orderedRiskSignals,
      }));
    }
    if (decision.providerEgress === "allow") {
      providerEnvelopes.push(entry.envelope);
    }
  }
  const localResultCount = input.entries.length;
  const fallbackReason = providerEnvelopes.length > 0 || localResultCount === 0
    ? null
    : quarantineCandidates.length === localResultCount
      ? "all_results_quarantined" as const
      : input.policy.providerEgress.mode === "local_only"
        ? "provider_egress_not_authorized" as const
        : "all_results_denied" as const;
  return Object.freeze({
    providerEnvelopes: Object.freeze(providerEnvelopes),
    quarantineCandidates: Object.freeze(quarantineCandidates),
    localResultCount,
    fallbackReason,
  });
}

export function detectPrivateRagRiskSignals(
  envelope: UntrustedContentEnvelope,
): readonly PrivateRagRiskSignal[] {
  const text = `${envelope.origin.sourceId}\n${JSON.stringify(envelope.payload)}`;
  return detectPrivateRagRiskSignalsText(text);
}

export function detectPrivateRagCollectionRiskSignals(
  envelopes: readonly UntrustedContentEnvelope[],
): readonly PrivateRagRiskSignal[] {
  if (envelopes.length < 2) return Object.freeze([]);
  return detectPrivateRagRiskSignalsText(envelopes.map((envelope) =>
    envelope.payload.kind === "text"
      ? envelope.payload.text
      : JSON.stringify(envelope.payload.value)
  ).join(" "));
}

function detectPrivateRagRiskSignalsText(
  text: string,
): readonly PrivateRagRiskSignal[] {
  const signals = new Set<PrivateRagRiskSignal>();
  if (/(?:^|\b)(?:system|developer|assistant)\s*(?::|message|instruction)|[<\[]\/?(?:system|developer)(?:\s|>|\])|["']role["']\s*:\s*["'](?:system|developer)["']|ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions?|(?:ignora|ignorez|ignoriere)\s+(?:las\s+|les\s+|die\s+)?(?:instrucciones|instructions|anweisungen)\s+(?:anteriores|pr[eé]c[eé]dentes|vorherigen)|reveal\s+(?:the\s+)?(?:prompt|secret)|(?:revela|r[eé]v[eè]le|enth[uü]lle)\s+(?:el\s+|le\s+|den\s+)?(?:prompt|secreto|secret|geheimnis)|call\s+(?:a\s+|the\s+)?tool\b/iu.test(text)) {
    signals.add("instruction_like");
  }
  if (/\b(?:owner|carl|administrator)\s+(?:has\s+)?(?:approved|authorized|permitted)|\b(?:policy|rules?)\s+(?:now\s+)?(?:allow|require|override)/iu.test(text)) {
    signals.add("policy_or_authority_claim");
  }
  if (/\b(?:search(?:ing)?|retriev(?:e|ing)|open(?:ing)?|read(?:ing)?|scann?ing|scan|load(?:ing)?|query(?:ing)?)\s+(?:all|another|other|unrelated|every)(?:\s+(?:other|unrelated))?\s+(?:notes?|files?|sources?|namespaces?|records?)/iu.test(text)) {
    signals.add("cross_source_directive");
  }
  if (text !== text.normalize("NFKC") || /%(?:[0-9a-f]{2})|&#(?:x[0-9a-f]+|\d+);|\\u[0-9a-f]{4}|(?:[A-Za-z0-9+/]{24,}={1,2})/iu.test(text)) {
    signals.add("alternate_encoding");
  }
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:OPENAI_API_KEY|SLACK_(?:BOT|APP)_TOKEN|AWS_SECRET_ACCESS_KEY)\s*=|\b(?:sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{20,})\b/u.test(text)) {
    signals.add("credential_like");
  }
  if (/(?:^|[^A-Za-z0-9])\/(?:Users|home|private|var|Volumes)\/|\b[A-Za-z]:\\(?:Users|Documents|Desktop|AppData)\\|\b(?:file|obsidian):\/\/|\bhttps?:\/\/(?:localhost|(?:10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|[^/\s]+\.(?:local|internal))\b/iu.test(text)) {
    signals.add("private_locator");
  }
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(text) || /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/u.test(text)) {
    signals.add("disallowed_contact_data");
  }
  return Object.freeze([...signals].sort());
}

function payloadClassMatchesOrigin(entry: PrivateRagProviderEntry): boolean {
  const expected: Partial<Record<
    UntrustedContentOriginKind,
    PrivateRagProviderPayloadClass
  >> = {
    obsidian_excerpt: "reviewed_excerpt",
    career_evidence: "reviewed_career_claim",
    recommendation: "reviewed_career_claim",
    conversation_quotation: "conversation_context",
    durable_memory: "work_context",
    task_event: "work_context",
    project_snapshot: "tool_observation",
    tool_result: "tool_observation",
    external_ai_text: "tool_observation",
  };
  return expected[entry.envelope.origin.kind] === entry.providerPayloadClass;
}

export function privateRagFallbackPayload(result: PrivateRagProviderGateResult): string {
  if (!result.fallbackReason) return "[]";
  return JSON.stringify({
    kind: "private_rag_fallback",
    reason: result.fallbackReason,
  });
}
