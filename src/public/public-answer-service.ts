import { z } from "zod";

import { tokenizeLexicalTerms } from "../domain/lexical-terms.js";
import { PUBLIC_JOLENE_DETERMINISTIC_COPY } from
  "../personality/runtime-personality-policy.js";
import {
  publicCharacterRegister,
  renderPublicVoiceResponse,
} from
  "../personality/public-character-realization.js";
import { selectJoleneResponseBeat } from
  "../personality/original-jolene-character-system.js";
import { publicCareerAdvocacyLead } from
  "../personality/public-career-advocacy.js";
import type { PersonalityMode } from "../personality/personality-mode.js";
import {
  PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
  type PublicCareerEvidenceArtifact,
  type PublicCareerEvidenceRecord,
} from "../domain/public-career-evidence.js";
import { PUBLIC_RESUME_PROJECT_DELIVERY_LIMITATION } from
  "../domain/public-resume-project-dossier.js";
import { PUBLIC_CAREER_CHAPTER_LIMITATION } from
  "../domain/public-career-profile-dossier.js";
import {
  PUBLIC_CONVERSATION_CONTEXT_LIMITS,
  PUBLIC_PORTFOLIO_ANSWER_LIMITS,
  portfolioAnswerResponseSchema,
  type PortfolioAnswerRequest,
  type PortfolioAnswerResponse,
  type PublicConversationContext,
} from "../domain/public-portfolio-contract.js";
import type { PublicModelRequestBudget } from "./public-model-request-budget.js";
import { suggestPublicFollowUpQuestions } from
  "./public-conversation-prompts.js";
import {
  PublicAnswerGroundingValidator,
  extractValidatedPublicVoiceBridges,
  type PublicAnswerGroundingValidatorLike,
} from "./public-answer-grounding-validator.js";
import {
  containsInternalPublicProcessLanguage,
  visitorFacingClaim,
  visitorFacingLimitations,
} from "./public-visitor-language.js";

export interface PublicPortfolioAnswerer {
  execute(
    artifact: PublicCareerEvidenceArtifact,
    request: PortfolioAnswerRequest,
  ): PublicAnswerExecution | Promise<PublicAnswerExecution>;
}

export interface PublicAnswerExecution {
  readonly response: PortfolioAnswerResponse;
  readonly mode:
    | "deterministic"
    | "model"
    | "budget_fallback"
    | "provider_fallback"
    | "validation_fallback";
  readonly responseKind:
    | "supported"
    | "clarification"
    | "no_evidence"
    | "policy_refusal";
}

export interface GroundedPublicAnswerInput {
  readonly question: string;
  readonly corpusVersion: string;
  readonly evidence: readonly {
    readonly evidenceId: string;
    readonly claimText: string;
    readonly limitations: readonly string[];
    readonly citationTitle: string;
  }[];
  readonly priorResponseBeat?: PublicConversationContext["responseBeat"];
}

export interface PublicAnswerTextGenerator {
  generate(input: GroundedPublicAnswerInput): Promise<unknown>;
}

export interface PublicEvidenceRetriever {
  retrieve(
    artifact: PublicCareerEvidenceArtifact,
    request: PortfolioAnswerRequest,
  ): Promise<readonly PublicCareerEvidenceRecord[]>;
}

export class DeterministicPublicAnswerService
  implements PublicPortfolioAnswerer
{
  execute(
    artifact: PublicCareerEvidenceArtifact,
    request: PortfolioAnswerRequest,
  ): PublicAnswerExecution {
    const response = this.answer(artifact, request);
    return {
      response,
      mode: "deterministic",
      responseKind: deterministicResponseKind(request, response),
    };
  }

  answer(
    artifact: PublicCareerEvidenceArtifact,
    request: PortfolioAnswerRequest,
  ): PortfolioAnswerResponse {
    const turn = resolvePublicConversationTurn(artifact, request);
    return this.answerFromSelected(
      artifact,
      turn.request,
      turn.contextualEvidence ??
        selectDeterministicPublicEvidence(artifact, turn.request),
      turn.responseContext,
    );
  }

  answerFromSelected(
    artifact: PublicCareerEvidenceArtifact,
    request: PortfolioAnswerRequest,
    selectedEvidence: readonly PublicCareerEvidenceRecord[],
    conversationContext?: PublicConversationContext,
  ): PortfolioAnswerResponse {
    if (isPrivateDisclosureRequest(request.question)) {
      return privateDisclosureResponse(artifact, request.question);
    }
    if (isRealPersonImitationRequest(request.question)) {
      return originalCharacterBoundaryResponse(artifact, request.question);
    }
    const conversationalTurn = publicConversationalTurn(request.question);
    if (conversationalTurn) {
      return conversationalTurnResponse(
        artifact,
        conversationalTurn,
        request.question,
      );
    }
    const hiringValueQuestion = isHiringValueQuestion(request.question);
    const engineerProfileQuestion = isEngineerProfileQuestion(request.question);
    const negativeHiringQuestion = isNegativeHiringQuestion(request.question);
    const strongestProjectQuestion = isStrongestProjectQuestion(request.question);
    const activeEvidence = new Map(
      artifact.evidence.map((record) => [record.evidenceId, record]),
    );
    const selected = uniqueRecords(selectedEvidence
      .map((record) => activeEvidence.get(record.evidenceId))
      .filter((record): record is PublicCareerEvidenceRecord => Boolean(record)))
      .slice(0, PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems);
    const conflict = artifact.conflicts.find((candidate) =>
      candidate.evidenceIds.some((evidenceId) =>
        selected.some((record) => record.evidenceId === evidenceId)
      )
    );
    const relationshipFact = exactRecommendationRelationship(
      request.question,
      selected,
    );

    const response = conflict
      ? conflictResponse(artifact, request.question, conversationContext)
      : selected.length === 0
      ? noEvidenceResponse(artifact, request.question, conversationContext)
      : supportedResponse(
        artifact,
        request.question,
        selected,
        hiringValueQuestion,
        engineerProfileQuestion,
        negativeHiringQuestion,
        strongestProjectQuestion,
        relationshipFact,
        conversationContext,
      );
    const contextEvidence = engineerProfileQuestion
      ? selected.filter((record) =>
        record.citation.sourceType === "project" ||
        record.citation.href.startsWith("/work/")
      ).slice(0, 1)
      : selected;
    return withConversationContext(
      response,
      response.claims.length > 0
        ? contextForSelectedEvidence(
          artifact,
          contextEvidence,
          conversationContext,
          request.question,
        )
        : undefined,
    );
  }
}

const generatedAnswerSchema = z.string().trim().min(1).max(2_000);

export class GroundedPublicAnswerService implements PublicPortfolioAnswerer {
  readonly #baseline: DeterministicPublicAnswerService;
  readonly #budget: PublicModelRequestBudget | undefined;
  readonly #retriever: PublicEvidenceRetriever | undefined;
  readonly #validator: PublicAnswerGroundingValidatorLike;
  readonly #personalityMode: PersonalityMode;

  constructor(
    private readonly generator: PublicAnswerTextGenerator,
    options: {
      readonly baseline?: DeterministicPublicAnswerService;
      readonly budget?: PublicModelRequestBudget;
      readonly retriever?: PublicEvidenceRetriever;
      readonly validator?: PublicAnswerGroundingValidatorLike;
      readonly personalityMode?: PersonalityMode;
    } = {},
  ) {
    this.#baseline = options.baseline ?? new DeterministicPublicAnswerService();
    this.#budget = options.budget;
    this.#retriever = options.retriever;
    this.#validator = options.validator ?? new PublicAnswerGroundingValidator();
    this.#personalityMode = options.personalityMode ?? "neutral";
  }

  async execute(
    artifact: PublicCareerEvidenceArtifact,
    request: PortfolioAnswerRequest,
  ): Promise<PublicAnswerExecution> {
    const turn = resolvePublicConversationTurn(artifact, request);
    const selectionRequest = turn.request;
    if (isPrivateDisclosureRequest(request.question)) {
      return {
        response: this.#baseline.answerFromSelected(
          artifact,
          request,
          [],
          undefined,
        ),
        mode: "deterministic",
        responseKind: "policy_refusal",
      };
    }
    if (isRealPersonImitationRequest(request.question)) {
      return {
        response: this.#baseline.answerFromSelected(artifact, request, [], undefined),
        mode: "deterministic",
        responseKind: "clarification",
      };
    }
    const conversationalTurn = publicConversationalTurn(request.question);
    if (conversationalTurn) {
      const response = this.#baseline.answerFromSelected(
        artifact,
        request,
        [],
        undefined,
      );
      return {
        response,
        mode: "deterministic",
        responseKind: conversationalTurn === "purpose" && response.claims.length > 0
          ? "supported"
          : "clarification",
      };
    }
    const exactRelationshipEvidence = turn.contextualEvidence
      ? []
      : selectRecommendationRelationshipEvidence(
        artifact.evidence,
        selectionRequest.question,
      );
    const deterministicEvidence = turn.contextualEvidence ??
      selectDeterministicPublicEvidence(artifact, selectionRequest);
    let baseline = exactRelationshipEvidence.length > 0
      ? this.#baseline.answerFromSelected(
        artifact,
        selectionRequest,
        exactRelationshipEvidence,
        turn.responseContext,
      )
      : this.#baseline.answerFromSelected(
        artifact,
        selectionRequest,
        deterministicEvidence,
        turn.responseContext,
      );
    if (
      this.#retriever && exactRelationshipEvidence.length === 0 &&
      !turn.contextualEvidence &&
      !isRiskHandlingQuestion(selectionRequest.question) &&
      !isStrongestProjectQuestion(selectionRequest.question)
    ) {
      try {
        baseline = this.#baseline.answerFromSelected(
          artifact,
          selectionRequest,
          await this.#retriever.retrieve(artifact, selectionRequest),
          turn.responseContext,
        );
      } catch {
        // Retrieval failure preserves the deterministic public-safe baseline.
      }
    }
    if (baseline.claims.length === 0) {
      return {
        response: baseline,
        mode: "deterministic",
        responseKind: deterministicResponseKind(selectionRequest, baseline),
      };
    }
    if (exactRelationshipEvidence.length > 0) {
      return {
        response: baseline,
        mode: "deterministic",
        responseKind: "supported",
      };
    }
    if (this.#budget) {
      try {
        if (!await this.#budget.reserve()) {
          return fallbackExecution(
            baseline,
            "budget_fallback",
            request.question,
            this.#personalityMode,
          );
        }
      } catch {
        return fallbackExecution(
          baseline,
          "budget_fallback",
          request.question,
          this.#personalityMode,
        );
      }
    }
    const generationInput = {
      question: request.question,
      corpusVersion: baseline.corpusVersion,
      ...(turn.priorResponseBeat
        ? { priorResponseBeat: turn.priorResponseBeat }
        : {}),
      evidence: baseline.claims.map((claim, index) => ({
        evidenceId: baseline.citations[index]?.evidenceId ?? "missing",
        claimText: claim.text,
        limitations: claim.limitations,
        citationTitle: baseline.citations[index]?.title ?? "Reviewed evidence",
      })),
    };
    let generation: unknown;
    try {
      generation = await this.generator.generate(generationInput);
    } catch {
      return fallbackExecution(
        baseline,
        "provider_fallback",
        request.question,
        this.#personalityMode,
      );
    }
    try {
      let validation = this.#validator.validate(artifact, baseline, generation);
      if (validation.status === "rejected") {
        // A model response can be factually sound yet fail a mechanical
        // grounding constraint (for example, an accidental extra sentence).
        // One fresh attempt is cheaper and more useful than immediately
        // reviving a stale deterministic voice. A second rejection still
        // fails closed to the reviewed baseline.
        try {
          generation = await this.generator.generate(generationInput);
        } catch {
          return fallbackExecution(
            baseline,
            "provider_fallback",
            request.question,
            this.#personalityMode,
          );
        }
        validation = this.#validator.validate(artifact, baseline, generation);
      }
      if (validation.status === "rejected") {
        if (validation.audit.status === "rejected" && process.env.VERCEL_ENV) {
          console.info(JSON.stringify({
            event: "public_answer_validation_rejected",
            reasonCode: validation.audit.reasonCode,
            segmentIndex: validation.audit.segmentIndex,
          }));
        }
        return fallbackExecution(
          baseline,
          "validation_fallback",
          request.question,
          this.#personalityMode,
          generation,
        );
      }
      const groundedAnswer = generatedAnswerSchema.parse(validation.answer);
      // Model-mode bridges have already passed the grounding validator. Do not
      // add a fixed frame here: that would overwrite question-specific voice.
      const answer = groundedAnswer;
      if (containsInternalPublicProcessLanguage(answer)) {
        return fallbackExecution(
          baseline,
          "validation_fallback",
          request.question,
          this.#personalityMode,
          generation,
        );
      }
      return {
        mode: "model",
        responseKind: "supported",
        response: portfolioAnswerResponseSchema.parse({
          ...baseline,
          answer,
        }),
      };
    } catch {
      return fallbackExecution(
        baseline,
        "validation_fallback",
        request.question,
        this.#personalityMode,
        generation,
      );
    }
  }
}

type PublicAnswerFallbackMode = Extract<
  PublicAnswerExecution["mode"],
  "budget_fallback" | "provider_fallback" | "validation_fallback"
>;

function fallbackExecution(
  baseline: PortfolioAnswerResponse,
  mode: PublicAnswerFallbackMode,
  question: string,
  personalityMode: PersonalityMode,
  generation?: unknown,
): PublicAnswerExecution {
  const bridges = personalityMode === "jolene"
    ? extractValidatedPublicVoiceBridges(generation)
    : [];
  const response = bridges.length > 0
    ? portfolioAnswerResponseSchema.parse({
      ...baseline,
      answer: renderPublicVoiceResponse(
        baseline.answer,
        bridges,
        PUBLIC_PORTFOLIO_ANSWER_LIMITS.answerCharacters,
      ),
    })
    : baseline;
  return {
    response,
    mode,
    responseKind: "supported",
  };
}

function deterministicResponseKind(
  request: PortfolioAnswerRequest,
  response: PortfolioAnswerResponse,
): PublicAnswerExecution["responseKind"] {
  if (isPrivateDisclosureRequest(request.question)) return "policy_refusal";
  if (isRealPersonImitationRequest(request.question)) return "clarification";
  const conversationalTurn = publicConversationalTurn(request.question);
  if (conversationalTurn) {
    return conversationalTurn === "purpose" && response.claims.length > 0
      ? "supported"
      : "clarification";
  }
  return response.claims.length === 0 ? "no_evidence" : "supported";
}

type PublicConversationalTurn =
  | "greeting"
  | "checkIn"
  | "gratitude"
  | "farewell"
  | "introduction"
  | "purpose";

function publicConversationalTurn(
  question: string,
): PublicConversationalTurn | null {
  const normalized = normalizeLookup(question);
  if (
    /^(?:(?:hi|hello|hey|howdy)(?: there)?(?: jolene)? )?(?:what s up|what is up|sup|what s new|what is new|what are you doing|how are you|how s it going|how is it going|how are things|how s your day|how is your day)(?: jolene)?$/u
      .test(normalized)
  ) return "checkIn";
  if (
    /^(?:hi|hello|hey|howdy)(?: there| jolene)?$/u.test(normalized) ||
    /^good (?:morning|afternoon|evening)(?: jolene)?$/u.test(normalized)
  ) return "greeting";
  if (
    /^(?:thanks|thank you)(?: jolene| very much)?$/u.test(normalized) ||
    /^(?:appreciate it|that helps|that was helpful)$/u.test(normalized)
  ) return "gratitude";
  if (
    /^(?:bye|goodbye|good night|see you|see you later|talk to you later|take care)(?: jolene)?$/u
      .test(normalized)
  ) return "farewell";
  if (
    /^(?:who are you|what are you|what can you do|how can you help)(?: jolene)?$/u
      .test(normalized)
  ) return "introduction";
  if (
    /^(?:why did carl (?:build|create|design) (?:you|jolene)|why were you (?:built|created|designed)|what made carl (?:build|create|design) (?:you|jolene)|what (?:is|s) your purpose|what are you for|why do you exist|why does jolene exist)$/u
      .test(normalized)
  ) return "purpose";
  return null;
}

function isRealPersonImitationRequest(question: string): boolean {
  const normalized = normalizeLookup(question);
  return /\b(?:talk|sound|speak|write|act)\b.{0,48}\b(?:exactly )?(?:like|as)\b/u
    .test(normalized);
}

export interface ResolvedPublicConversationTurn {
  readonly request: PortfolioAnswerRequest;
  readonly responseContext?: PublicConversationContext;
  readonly contextualEvidence?: readonly PublicCareerEvidenceRecord[];
  readonly usedPriorContext: boolean;
  readonly priorResponseBeat?: PublicConversationContext["responseBeat"];
}

export function resolvePublicConversationTurn(
  artifact: PublicCareerEvidenceArtifact,
  request: PortfolioAnswerRequest,
  now = new Date(),
): ResolvedPublicConversationTurn {
  const explicitProjectPath = matchPublicProjectEntityPath(
    artifact.evidence,
    request.question,
  );
  const prior = validPriorConversationContext(artifact, request, now);
  const canUsePrior = Boolean(
    prior &&
    (prior.projectPath || permitsEvidenceOnlyCarryover(request.question)) &&
    !explicitProjectPath &&
    isContextualFollowUp(request.question) &&
    !isPrivateDisclosureRequest(request.question) &&
    !PROMPT_INJECTION_CARRYOVER_PATTERN.test(normalizeLookup(request.question)) &&
    !RECOMMENDATION_RELATIONSHIP_QUESTION.test(normalizeLookup(request.question)) &&
    !isHiringValueQuestion(request.question),
  );
  const projectPath = explicitProjectPath ?? (canUsePrior ? prior?.projectPath : undefined);
  const contextualEvidence = canUsePrior && !explicitProjectPath
    ? prior?.projectPath
      ? selectContextualProjectEvidence(
        artifact.evidence,
        request.question,
        prior.projectPath,
      )
      : recordsForContext(artifact, prior)
    : [];
  if (!projectPath && contextualEvidence.length === 0) {
    return { request, usedPriorContext: false };
  }

  const continuingPrior = canUsePrior ? prior : null;
  const turnCount = continuingPrior
    ? Math.min(
      continuingPrior.turnCount + 1,
      PUBLIC_CONVERSATION_CONTEXT_LIMITS.turns,
    )
    : 1;
  const responseContext = {
    corpusVersion: artifact.manifest.corpusVersion,
    ...(projectPath ? { projectPath } : {}),
    ...(contextualEvidence.length > 0
      ? { evidenceIds: contextualEvidence.map((record) => record.evidenceId) }
      : {}),
    responseBeat: selectJoleneResponseBeat(
      request.question,
      publicCharacterRegister(request.question),
    ),
    turnCount,
    expiresAt: new Date(
      now.getTime() + PUBLIC_CONVERSATION_CONTEXT_LIMITS.lifetimeSeconds * 1_000,
    ).toISOString(),
  } satisfies PublicConversationContext;
  if (!continuingPrior) {
    return { request, responseContext, usedPriorContext: false };
  }
  if (!projectPath) {
    return {
      request,
      responseContext,
      contextualEvidence,
      usedPriorContext: true,
      ...(prior?.responseBeat ? { priorResponseBeat: prior.responseBeat } : {}),
    };
  }
  return {
    request: {
      ...request,
      question: `${request.question}\nContextual project: ${projectPath
        .slice("/work/".length)
        .replaceAll("-", " ")}.`,
    },
    responseContext,
    contextualEvidence,
    usedPriorContext: true,
    ...(prior?.responseBeat ? { priorResponseBeat: prior.responseBeat } : {}),
  };
}

function validPriorConversationContext(
  artifact: PublicCareerEvidenceArtifact,
  request: PortfolioAnswerRequest,
  now: Date,
): PublicConversationContext | null {
  const context = request.conversationContext;
  if (
    !context ||
    context.corpusVersion !== artifact.manifest.corpusVersion ||
    context.turnCount >= PUBLIC_CONVERSATION_CONTEXT_LIMITS.turns ||
    Date.parse(context.expiresAt) <= now.getTime() ||
    Date.parse(context.expiresAt) >
      now.getTime() + PUBLIC_CONVERSATION_CONTEXT_LIMITS.lifetimeSeconds * 1_000
  ) return null;
  const projectExists = context.projectPath
    ? artifact.evidence.some((record) =>
      record.citation.href === context.projectPath ||
      record.citation.href.startsWith(`${context.projectPath}#`)
    )
    : false;
  const evidenceExists = context.evidenceIds?.length
    ? context.evidenceIds.every((evidenceId) =>
      artifact.evidence.some((record) => record.evidenceId === evidenceId)
    )
    : false;
  return projectExists || evidenceExists ? context : null;
}

function recordsForContext(
  artifact: PublicCareerEvidenceArtifact,
  context: PublicConversationContext | null,
): PublicCareerEvidenceRecord[] {
  if (!context) return [];
  const evidenceIds = new Set(context.evidenceIds ?? []);
  if (evidenceIds.size > 0) {
    return artifact.evidence.filter((record) => evidenceIds.has(record.evidenceId));
  }
  return context.projectPath
    ? artifact.evidence.filter((record) =>
      record.citation.href === context.projectPath ||
      record.citation.href.startsWith(`${context.projectPath}#`)
    ).slice(0, PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems)
    : [];
}

function selectContextualProjectEvidence(
  evidence: readonly PublicCareerEvidenceRecord[],
  question: string,
  projectPath: string,
): PublicCareerEvidenceRecord[] {
  const projectEvidence = evidence.filter((record) =>
    record.citation.href === projectPath ||
    record.citation.href.startsWith(`${projectPath}#`)
  );
  const intent = deterministicAnswerIntent(question, projectEvidence);
  if (
    intent === "source" ||
    intent === "boundary" ||
    permitsEvidenceOnlyCarryover(question)
  ) {
    return projectEvidence.slice(0, PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems);
  }
  const queryTerms = tokenizeLexicalTerms(question).filter(
    (term) => !PUBLIC_CONTEXTUAL_QUERY_STOP_WORDS.has(term),
  );
  return selectLexicalEvidence(projectEvidence, queryTerms, 1);
}

function contextForSelectedEvidence(
  artifact: PublicCareerEvidenceArtifact,
  selected: readonly PublicCareerEvidenceRecord[],
  current: PublicConversationContext | undefined,
  question: string,
  now = new Date(),
): PublicConversationContext | undefined {
  if (selected.length === 0) return undefined;
  const selectedProjectPaths = new Set(selected.flatMap((record) => {
    const path = record.citation.href.match(/^(\/work\/[a-z0-9-]+)(?:#|$)/u)?.[1];
    return path ? [path] : [];
  }));
  const sharedProjectPath = selectedProjectPaths.size === 1 &&
      selected.every((record) =>
        record.citation.href === [...selectedProjectPaths][0] ||
        record.citation.href.startsWith(`${[...selectedProjectPaths][0]}#`)
      )
    ? [...selectedProjectPaths][0]
    : undefined;
  return {
    corpusVersion: artifact.manifest.corpusVersion,
    ...(current?.projectPath || sharedProjectPath
      ? { projectPath: current?.projectPath ?? sharedProjectPath }
      : {}),
    evidenceIds: selected.map((record) => record.evidenceId),
    responseBeat: selectJoleneResponseBeat(
      question,
      publicCharacterRegister(question),
    ),
    turnCount: current?.turnCount ?? 1,
    expiresAt: current?.expiresAt ?? new Date(
      Math.floor(now.getTime() / 1_000) * 1_000 +
        PUBLIC_CONVERSATION_CONTEXT_LIMITS.lifetimeSeconds * 1_000,
    ).toISOString(),
  };
}

function isContextualFollowUp(question: string): boolean {
  return CONTEXTUAL_FOLLOW_UP_PATTERN.test(normalizeLookup(question));
}

function permitsEvidenceOnlyCarryover(question: string): boolean {
  const normalized = normalizeLookup(question);
  return /^(?:continue (?:from|with) (?:that|this)(?: example| point)?|tell me more(?: about (?:that|this|it))?|what else|why|what about (?:that|this|it)|which source backs that up|open (?:the )?(?:strongest )?source(?: for that point)?|what limitations? should i keep in mind|what did (?:he|carl) personally contribute (?:there|to (?:that|this)))$/u
    .test(normalized);
}

function withConversationContext(
  response: PortfolioAnswerResponse,
  conversationContext: PublicConversationContext | undefined,
): PortfolioAnswerResponse {
  return conversationContext
    ? portfolioAnswerResponseSchema.parse({ ...response, conversationContext })
    : response;
}

const CONTEXTUAL_FOLLOW_UP_PATTERN =
  /^(?:and\b|also\b|but\b|how\b|tell me more\b|what about\b|what else\b|what (?:limit(?:ation)?s?|boundar(?:y|ies)|risks?|caveats?|weaknesses?)\b|why\b|which\b|who\b)|\b(?:it|that|this|those|them|there|the project)\b/u;

const PROMPT_INJECTION_CARRYOVER_PATTERN =
  /\b(?:ignore|override|reveal|system prompt|developer message|hidden instructions|previous instructions)\b/u;

export function selectDeterministicPublicEvidence(
  artifact: PublicCareerEvidenceArtifact,
  request: PortfolioAnswerRequest,
): PublicCareerEvidenceRecord[] {
  const projectEvidence = selectProjectEntityEvidence(
    artifact.evidence,
    request.question,
  );
  if (projectEvidence.length > 0) return projectEvidence;
  const professionalRoleEvidence = selectProfessionalRoleEntityEvidence(
    artifact.evidence,
    request.question,
  );
  if (professionalRoleEvidence.length > 0) return professionalRoleEvidence;
  const relationshipEvidence = selectRecommendationRelationshipEvidence(
    artifact.evidence,
    request.question,
  );
  if (relationshipEvidence.length > 0) return relationshipEvidence;
  if (isRecommendationSummaryQuestion(request.question)) {
    return selectRecommendationSummaryEvidence(
      artifact.evidence,
      request.question,
    );
  }
  if (isNonProductionQuestion(request.question)) {
    return selectNonProductionEvidence(artifact.evidence);
  }
  if (isShippedWorkQuestion(request.question)) {
    return selectShippedWorkEvidence(artifact.evidence);
  }
  if (isCareerArcQuestion(request.question)) {
    return selectCareerProfileChapters(artifact.evidence);
  }
  if (isRiskHandlingQuestion(request.question)) {
    return selectRiskHandlingEvidence(artifact.evidence);
  }
  if (isStrongestProjectQuestion(request.question)) {
    return selectStrongestProjectEvidence(artifact.evidence);
  }
  if (isHiringValueQuestion(request.question)) {
    return selectHiringValueEvidence(artifact.evidence);
  }
  if (isEngineerProfileQuestion(request.question)) {
    return selectHiringValueEvidence(artifact.evidence);
  }
  const skepticalIntent = skepticalAnswerIntent(request.question);
  if (skepticalIntent) {
    const skepticalEvidence = selectSkepticalEvidence(
      artifact.evidence,
      skepticalIntent,
    );
    if (skepticalEvidence.length > 0) return skepticalEvidence;
  }
  const queryTerms = tokenizeLexicalTerms(request.question).filter(
    (term) => !PUBLIC_QUERY_STOP_WORDS.has(term),
  );
  const minimumScore = requiresCorroboratingLexicalMatch(request.question)
    ? Math.min(3, queryTerms.length)
    : 1;
  return selectLexicalEvidence(artifact.evidence, queryTerms, minimumScore);
}

function selectProfessionalRoleEntityEvidence(
  evidence: readonly PublicCareerEvidenceRecord[],
  question: string,
): PublicCareerEvidenceRecord[] {
  const normalizedQuestion = normalizeLookup(question);
  const matched = evidence.filter((record) => {
    const employer = record.citation.title.match(/\bat\s+(.+)$/u)?.[1];
    return employer && employerAliases(employer).some((alias) =>
      normalizedQuestion.includes(alias)
    );
  });
  if (matched.length === 0) return [];
  return matched
    .map((record) => ({ record, score: projectOverviewScore(record) }))
    .sort(compareScoredEvidence)
    .slice(0, PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems)
    .map(({ record }) => record);
}

function employerAliases(employer: string): readonly string[] {
  const aliases = new Set<string>();
  const normalized = normalizeLookup(employer);
  aliases.add(normalized);
  for (const part of employer.split("/")) {
    const alias = normalizeLookup(part);
    if (alias.length >= 3) aliases.add(alias);
  }
  for (const candidate of [...aliases]) {
    const withoutPrefix = candidate.replace(/^u s\s+/u, "");
    const withoutSuffix = candidate.replace(
      /\s+(?:advertising|company|international|land systems|studios)$/u,
      "",
    );
    if (withoutPrefix.length >= 3) aliases.add(withoutPrefix);
    if (withoutSuffix.length >= 3) aliases.add(withoutSuffix);
  }
  return [...aliases];
}

function selectProjectEntityEvidence(
  evidence: readonly PublicCareerEvidenceRecord[],
  question: string,
): PublicCareerEvidenceRecord[] {
  const projectPath = matchPublicProjectEntityPath(evidence, question);
  if (!projectPath) return [];
  const projectEvidence = evidence.filter((record) =>
    record.citation.href === projectPath ||
    record.citation.href.startsWith(`${projectPath}#`)
  );
  const normalizedQuestion = normalizeLookup(question);
  const queryTerms = tokenizeLexicalTerms(question).filter(
    (term) => !PUBLIC_QUERY_STOP_WORDS.has(term),
  );
  const howBuilt = /\b(?:how|build|built|designed|architecture|work|works)\b/u
    .test(normalizedQuestion);
  return projectEvidence
    .map((record) => ({
      record,
      score: score(record, queryTerms) + projectOverviewScore(record) +
        (howBuilt ? howBuiltScore(record) : 0),
    }))
    .sort(compareScoredEvidence)
    .slice(0, PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems)
    .map(({ record }) => record);
}

export function matchPublicProjectEntityPath(
  evidence: readonly PublicCareerEvidenceRecord[],
  question: string,
): string | null {
  const normalizedQuestion = normalizeLookup(question);
  const slugs = [...new Set(evidence.flatMap((record) => {
    const slug = record.citation.href.match(/^\/work\/([a-z0-9-]+)(?:#|$)/u)?.[1];
    return slug ? [slug] : [];
  }))];
  if (
    slugs.includes("jolene-ai") &&
    JOLENE_SELF_REFERENCE_PROJECT_PATTERN.test(normalizedQuestion)
  ) return "/work/jolene-ai";
  const matchedSlug = slugs
    .map((slug) => ({ slug, aliases: projectAliases(slug) }))
    .filter(({ aliases }) => aliases.some((alias) =>
      (` ${normalizedQuestion} `).includes(` ${alias} `)
    ))
    .sort((left, right) =>
      Math.max(...right.aliases.map((alias) => alias.length)) -
        Math.max(...left.aliases.map((alias) => alias.length)) ||
      left.slug.localeCompare(right.slug)
    )[0]?.slug;
  return matchedSlug ? `/work/${matchedSlug}` : null;
}

const JOLENE_SELF_REFERENCE_PROJECT_PATTERN =
  /\b(?:(?:how|why) (?:did carl )?(?:build|create|design) you|(?:how|why) were you (?:built|created|designed)|how do you work|what (?:model|architecture|retrieval|rag|security|privacy) (?:do you use|are you using|do you have)|what powers you|your (?:model|architecture|retrieval|rag|security|privacy))\b/u;

function projectAliases(slug: string): string[] {
  const tokens = slug.split("-");
  const descriptive = tokens.filter((token) => token !== "ai" && token !== "os");
  return [...new Set([
    tokens.join(" "),
    descriptive.join(" "),
  ].filter((alias) => alias.length >= 3))];
}

function projectOverviewScore(record: PublicCareerEvidenceRecord): number {
  const text = normalizeLookup(`${record.citation.title} ${record.claim.text}`);
  return PROJECT_OVERVIEW_TERMS.reduce(
    (total, [term, weight]) => total + (text.includes(term) ? weight : 0),
    0,
  );
}

function howBuiltScore(record: PublicCareerEvidenceRecord): number {
  const text = normalizeLookup(`${record.citation.title} ${record.claim.text}`);
  return HOW_BUILT_TERMS.reduce(
    (total, [term, weight]) => total + (text.includes(term) ? weight : 0),
    0,
  );
}

const PROJECT_OVERVIEW_TERMS = [
  ["designed", 10],
  ["originated", 10],
  ["architecture", 9],
  ["openai", 8],
  ["retrieval", 7],
  ["personality", 6],
] as const;

const HOW_BUILT_TERMS = [
  ["originated", 16],
  ["directed", 14],
  ["designed", 12],
  ["architecture", 12],
  ["openai", 10],
  ["synthesis", 9],
  ["retrieval", 9],
  ["hybrid", 8],
  ["docker", 7],
  ["runtime", 6],
  ["backend for frontend", 5],
] as const;

interface RecommendationRelationshipFact {
  readonly subject: string;
  readonly relationship: string;
  readonly record: PublicCareerEvidenceRecord;
}

function selectRecommendationRelationshipEvidence(
  evidence: readonly PublicCareerEvidenceRecord[],
  question: string,
): PublicCareerEvidenceRecord[] {
  if (!RECOMMENDATION_RELATIONSHIP_QUESTION.test(normalizeLookup(question))) {
    return [];
  }
  const normalizedQuestion = normalizeLookup(question);
  const match = evidence.find((record) => {
    const fact = recommendationRelationshipFact(record);
    return fact !== null && normalizedQuestion.includes(normalizeLookup(fact.subject));
  });
  return match ? [match] : [];
}

function isRecommendationSummaryQuestion(question: string): boolean {
  return /\b(?:recommendations?|references?|testimonials?)\b/u
    .test(normalizeLookup(question));
}

function selectRecommendationSummaryEvidence(
  evidence: readonly PublicCareerEvidenceRecord[],
  question: string,
): PublicCareerEvidenceRecord[] {
  const queryTerms = tokenizeLexicalTerms(question).filter(
    (term) => !PUBLIC_QUERY_STOP_WORDS.has(term),
  );
  return evidence
    .filter((record) =>
      record.citation.sourceType === "recommendation" ||
      record.citation.title.startsWith("Recommendation from ")
    )
    .map((record) => ({ record, score: score(record, queryTerms) }))
    .sort(compareScoredEvidence)
    .slice(0, 2)
    .map(({ record }) => record);
}

function exactRecommendationRelationship(
  question: string,
  evidence: readonly PublicCareerEvidenceRecord[],
): RecommendationRelationshipFact | null {
  const selected = selectRecommendationRelationshipEvidence(evidence, question)[0];
  return selected ? recommendationRelationshipFact(selected) : null;
}

function recommendationRelationshipFact(
  record: PublicCareerEvidenceRecord,
): RecommendationRelationshipFact | null {
  if (!record.citation.title.startsWith("Recommendation from ")) return null;
  const subject = record.citation.title.slice("Recommendation from ".length).trim();
  const limitation = record.claim.limitations.find((candidate) =>
    candidate.startsWith("Contribution boundary: Third-party statement attributed to ")
  );
  const match = limitation?.match(
    /^Contribution boundary: Third-party statement attributed to .+? \((.+?)\);/u,
  );
  if (!subject || !match?.[1]) return null;
  const firstName = subject.split(/\s+/u)[0] ?? subject;
  const relationship = match[1].startsWith(`${firstName} `)
    ? `${subject}${match[1].slice(firstName.length)}`
    : match[1];
  return { subject, relationship, record };
}

function normalizeLookup(value: string): string {
  return value.toLocaleLowerCase("en-US").normalize("NFKC")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

const RECOMMENDATION_RELATIONSHIP_QUESTION =
  /\b(?:relationship|employer|client|boss|supervisor|manager|worked for|worked with)\b/u;

const PUBLIC_QUERY_STOP_WORDS = new Set([
  "about",
  "answer",
  "been",
  "can",
  "carl",
  "definite",
  "evidence",
  "even",
  "give",
  "if",
  "need",
  "no",
  "portfolio",
  "public",
  "review",
  "reviewed",
  "show",
  "shown",
  "unclear",
  "tell",
  "will",
  "welch",
  "yes",
]);

const PUBLIC_CONTEXTUAL_QUERY_STOP_WORDS = new Set([
  ...PUBLIC_QUERY_STOP_WORDS,
  "about",
  "it",
  "its",
  "that",
  "this",
  "what",
]);

function score(
  record: PublicCareerEvidenceRecord,
  queryTerms: readonly string[],
): number {
  const candidateTerms = new Set(tokenizeLexicalTerms([
    record.claim.text,
    record.claim.limitations.join(" "),
    record.citation.title,
    record.citation.sourceType,
    record.citation.maturity,
  ].join(" ")));
  return queryTerms.reduce(
    (total, term) => total + (candidateTerms.has(term) ? 1 : 0),
    0,
  );
}

function selectLexicalEvidence(
  evidence: readonly PublicCareerEvidenceRecord[],
  queryTerms: readonly string[],
  minimumScore = 1,
): PublicCareerEvidenceRecord[] {
  return evidence
    .map((record) => ({ record, score: score(record, queryTerms) }))
    .filter((candidate) => candidate.score >= minimumScore)
    .sort(compareScoredEvidence)
    .slice(0, PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems)
    .map((candidate) => candidate.record);
}

function requiresCorroboratingLexicalMatch(question: string): boolean {
  const normalized = normalizeLookup(question);
  return /\b(?:availability|certified|confidential|guarantee|operated|qualified|salary|compensation)\b/u
    .test(normalized) ||
    /\bmanaged\b.{0,48}\bteam\b/u.test(normalized) ||
    /\bsole\b.{0,48}\bauthor\b/u.test(normalized);
}

function isNonProductionQuestion(question: string): boolean {
  return /\b(?:not|isn t|isn['’]t|wasn t|wasn['’]t)\b.{0,32}\bproduction\b/u
    .test(normalizeLookup(question));
}

function isRiskHandlingQuestion(question: string): boolean {
  const normalized = normalizeLookup(question);
  return (
    /\b(?:handle|handles|handling|manage|manages|managing|mitigate|mitigates|mitigating|reduce|reduces|reducing|control|controls|controlling|contain|contains|containing|address|addresses|addressing)\b.{0,64}\b(?:ai |artificial intelligence |model |agent |automation )?(?:risk|risks|safety)\b/u
      .test(normalized) ||
    /\b(?:ai |artificial intelligence |model |agent |automation )?(?:risk|risks|safety)\b.{0,64}\b(?:handle|handles|handling|manage|manages|managing|mitigate|mitigates|mitigating|reduce|reduces|reducing|control|controls|controlling|contain|contains|containing|address|addresses|addressing)\b/u
      .test(normalized)
  );
}

type RiskHandlingCategory =
  | "authority"
  | "data"
  | "evidence"
  | "validation"
  | "operations";

const RISK_HANDLING_CATEGORY_PRIORITY: readonly RiskHandlingCategory[] = [
  "authority",
  "data",
  "evidence",
  "validation",
  "operations",
];

const RISK_HANDLING_CATEGORY_TERMS: Readonly<Record<
  RiskHandlingCategory,
  readonly string[]
>> = {
  authority: [
    "human approval",
    "human authorization",
    "approve the exact action",
    "consequential actions",
    "no model tools",
    "read only",
    "disabled",
  ],
  data: [
    "private",
    "public",
    "untrusted",
    "prompt injection",
    "disclosure",
    "sensitive",
    "least privilege",
  ],
  evidence: [
    "source evidence",
    "provenance",
    "review state",
    "uncertainty",
    "approved",
    "deny by default",
    "revocation",
  ],
  validation: [
    "validation",
    "structured output",
    "bounded",
    "policy first",
    "fails closed",
    "fail closed",
  ],
  operations: [
    "release gate",
    "rollback",
    "monitoring",
    "evaluation",
    "production promotion",
    "corpus pinning",
  ],
};

const AI_SYSTEM_LEXICAL_TERMS = [
  "ai",
  "agent",
  "agentic",
  "automation",
  "generated",
  "model",
  "rag",
  "retrieval",
  "prompt",
  "jolene",
  "supraconscious",
] as const;

const AI_SYSTEM_PHRASES = [
  "artificial intelligence",
  "generated answer",
] as const;

function selectRiskHandlingEvidence(
  evidence: readonly PublicCareerEvidenceRecord[],
): PublicCareerEvidenceRecord[] {
  const ranked = evidence
    .map((record) => ({ record, ...riskHandlingEvidenceScore(record) }))
    .filter(({ score }) => score > 0)
    .sort(compareScoredEvidence);
  const selected: PublicCareerEvidenceRecord[] = [];
  for (const category of RISK_HANDLING_CATEGORY_PRIORITY) {
    const candidate = ranked.find(({ record, categories }) =>
      categories.has(category) && !selected.includes(record)
    );
    if (candidate) selected.push(candidate.record);
  }
  for (const candidate of ranked) {
    if (selected.length >= PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems) break;
    if (!selected.includes(candidate.record)) selected.push(candidate.record);
  }
  return selected.slice(0, PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems);
}

function riskHandlingEvidenceScore(record: PublicCareerEvidenceRecord): {
  readonly categories: ReadonlySet<RiskHandlingCategory>;
  readonly score: number;
} {
  const text = normalizeLookup([
    record.citation.title,
    record.claim.text,
  ].join(" "));
  const lexicalTerms = new Set(tokenizeLexicalTerms(text));
  if (
    !AI_SYSTEM_LEXICAL_TERMS.some((term) => lexicalTerms.has(term)) &&
    !AI_SYSTEM_PHRASES.some((phrase) => text.includes(phrase))
  ) {
    return { categories: new Set<RiskHandlingCategory>(), score: 0 };
  }
  const categories = new Set<RiskHandlingCategory>();
  let score = 0;
  for (const category of RISK_HANDLING_CATEGORY_PRIORITY) {
    const matches = RISK_HANDLING_CATEGORY_TERMS[category]
      .filter((term) => text.includes(term)).length;
    if (matches > 0) categories.add(category);
    score += matches * 10;
  }
  return { categories, score };
}

function selectNonProductionEvidence(
  evidence: readonly PublicCareerEvidenceRecord[],
): PublicCareerEvidenceRecord[] {
  return evidence
    .filter((record) => record.citation.maturity !== "production")
    .map((record) => ({
      record,
      score: nonProductionEvidenceScore(record),
    }))
    .filter(({ score }) => score > 0)
    .sort(compareScoredEvidence)
    .slice(0, PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems)
    .map(({ record }) => record);
}

export function isShippedWorkQuestion(question: string): boolean {
  const normalized = normalizeLookup(question);
  if (/\b(?:not|never|hasn t|haven t|didn t)\b.{0,32}\b(?:ship|shipped|launch|launched|release|released|deliver|delivered)\b/u
    .test(normalized)) return false;
  return /\b(?:what|which|show|tell)\b.{0,64}\b(?:ship|shipped|launch|launched|release|released|deliver|delivered|put into production)\b/u
      .test(normalized) ||
    /\b(?:ship|shipped|launch|launched|release|released|deliver|delivered)\b.{0,64}\b(?:work|products?|projects?|software|systems?)\b/u
      .test(normalized);
}

function selectShippedWorkEvidence(
  evidence: readonly PublicCareerEvidenceRecord[],
): PublicCareerEvidenceRecord[] {
  const careerChapters = selectCareerProfileChapters(evidence);
  if (careerChapters.length > 0) return careerChapters;
  return evidence
    .filter((record) =>
      record.citation.sourceType === "resume" &&
      record.claim.limitations.includes(PUBLIC_RESUME_PROJECT_DELIVERY_LIMITATION)
    )
    .sort((left, right) =>
      resumeProjectPriority(left.citation.title) -
        resumeProjectPriority(right.citation.title) ||
      left.evidenceId.localeCompare(right.evidenceId)
    )
    .slice(0, PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems);
}

function selectCareerProfileChapters(
  evidence: readonly PublicCareerEvidenceRecord[],
): PublicCareerEvidenceRecord[] {
  return evidence
    .filter((record) =>
      record.claim.limitations.includes(PUBLIC_CAREER_CHAPTER_LIMITATION)
    )
    .sort((left, right) =>
      careerChapterPriority(left.citation.title) -
        careerChapterPriority(right.citation.title) ||
      left.evidenceId.localeCompare(right.evidenceId)
    )
    .slice(0, PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems);
}

const CAREER_CHAPTER_ORDER = [
  "Career chapter: More than 20 years of delivery",
  "Career chapter: Product engineering and leadership",
  "Career chapter: Studios, agencies, and technical teams",
  "Career chapter: Operational, evidence, and immersive systems",
  "Career chapter: Current independent products",
] as const;

function careerChapterPriority(title: string): number {
  const index = CAREER_CHAPTER_ORDER.indexOf(
    title as (typeof CAREER_CHAPTER_ORDER)[number],
  );
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function isCareerArcQuestion(question: string): boolean {
  const normalized = normalizeLookup(question);
  return /\b(?:walk me through|summarize|describe|tell me about|what is|what s)\b.{0,64}\b(?:carl s )?(?:career|work experience|professional experience|career arc|background)\b/u
      .test(normalized) ||
    /\b(?:career|work experience|professional experience|career arc)\b.{0,64}\b(?:span|history|journey|overview|look like)\b/u
      .test(normalized);
}

const RESUME_PROJECT_ORDER = [
  "ProgressionLab",
  "Job Search OS",
  "Flight Tracker AI",
  "Supraconscious Avatar AI",
  "Argent Matchmaking",
] as const;

function resumeProjectPriority(title: string): number {
  const index = RESUME_PROJECT_ORDER.indexOf(
    title as (typeof RESUME_PROJECT_ORDER)[number],
  );
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function nonProductionEvidenceScore(record: PublicCareerEvidenceRecord): number {
  const text = normalizeLookup([
    record.claim.text,
    record.claim.limitations.join(" "),
    record.citation.title,
  ].join(" "));
  const maturityScore = record.citation.maturity === "deployed_demo"
    ? 16
    : record.citation.maturity === "prototype"
    ? 14
    : record.citation.maturity === "development"
    ? 12
    : 0;
  const boundaryScore = /\b(?:demo|demonstration|development|not publicly released|pre release|prototype|tester build)\b/u
      .test(text)
    ? 10
    : 0;
  const publicProjectScore = /^(?:project|repository|release_artifact|portfolio_page)$/u
      .test(record.citation.sourceType)
    ? 4
    : 0;
  return maturityScore + boundaryScore + publicProjectScore;
}

type HiringEvidenceCategory =
  | "leadership"
  | "professional_role"
  | "capability"
  | "product"
  | "testimonial";

function selectHiringValueEvidence(
  evidence: readonly PublicCareerEvidenceRecord[],
): PublicCareerEvidenceRecord[] {
  const ranked = evidence
    .map((record) => ({ record, score: hiringValueScore(record) }))
    .filter((candidate) => candidate.score > 0)
    .sort(compareScoredEvidence);
  const selected: PublicCareerEvidenceRecord[] = [];
  for (const category of HIRING_CATEGORY_PRIORITY) {
    const candidate = ranked.find(({ record }) =>
      !selected.includes(record) && hiringCategory(record) === category
    );
    if (candidate) selected.push(candidate.record);
  }
  for (const candidate of ranked) {
    if (selected.length >= PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems) break;
    if (!selected.includes(candidate.record)) selected.push(candidate.record);
  }
  return selected.slice(0, PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems);
}

function compareScoredEvidence(
  left: { readonly record: PublicCareerEvidenceRecord; readonly score: number },
  right: { readonly record: PublicCareerEvidenceRecord; readonly score: number },
): number {
  return right.score - left.score ||
    left.record.evidenceId.localeCompare(right.record.evidenceId);
}

const HIRING_CATEGORY_PRIORITY: readonly HiringEvidenceCategory[] = [
  "leadership",
  "professional_role",
  "capability",
  "product",
  "testimonial",
];

function hiringCategory(
  record: PublicCareerEvidenceRecord,
): HiringEvidenceCategory {
  const title = record.citation.title.toLocaleLowerCase("en-US");
  const text = `${title} ${record.claim.text}`.toLocaleLowerCase("en-US");
  if (title === "technical leadership" || /\b(?:leading|leadership|managed)\b/u.test(text)) {
    return "leadership";
  }
  if (/\b(?:senior|lead|manager)\b.+\bat\b/u.test(title)) {
    return "professional_role";
  }
  if (title.startsWith("recommendation from ")) return "testimonial";
  if (record.citation.maturity === "production" ||
    record.citation.maturity === "deployed_demo" ||
    record.citation.maturity === "pre_release") {
    return "product";
  }
  return "capability";
}

function hiringValueScore(record: PublicCareerEvidenceRecord): number {
  const title = record.citation.title.toLocaleLowerCase("en-US");
  const text = `${title} ${record.claim.text}`.toLocaleLowerCase("en-US");
  let value = HIRING_VALUE_TERMS.reduce(
    (total, term) => total + (text.includes(term) ? 2 : 0),
    0,
  );
  if (title === "technical leadership") value += 24;
  if (/\b(?:senior|lead|manager)\b.+\bat\b/u.test(title)) value += 16;
  if (title === "bounded ai workflows" || title === "product interface systems") {
    value += 18;
  }
  if (title.startsWith("recommendation from ")) value += 8;
  if (record.citation.maturity === "production") value += 7;
  if (record.citation.maturity === "deployed_demo") value += 4;
  if (HIRING_BOUNDARY_ONLY_PATTERNS.some((pattern) => pattern.test(text))) {
    value -= 24;
  }
  return value;
}

const HIRING_VALUE_TERMS = [
  "built",
  "delivered",
  "design",
  "developed",
  "engineer",
  "frontend",
  "high-performance",
  "interface",
  "led",
  "managed",
  "mentor",
  "product",
  "react",
  "security",
  "system",
  "team",
  "typescript",
] as const;

const HIRING_BOUNDARY_ONLY_PATTERNS = [
  /\bnot (?:a|intended|represented)\b/u,
  /\brather than a public\b/u,
  /\bdo not replace\b/u,
  /\bremaining .+ checks\b/u,
  /\bpre-release tester builds\b/u,
] as const;

function isHiringValueQuestion(question: string): boolean {
  const normalized = question.toLocaleLowerCase("en-US").normalize("NFKC");
  if (HIRING_VALUE_UNSAFE_PATTERN.test(normalized)) return false;
  return HIRING_VALUE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isEngineerProfileQuestion(question: string): boolean {
  const normalized = normalizeLookup(question);
  return /\bwhat kind of engineer is carl\b/u.test(normalized) ||
    /\bhow would you describe carl as an? engineer\b/u.test(normalized) ||
    /\bwhat makes carl an? [a-z ]{0,32}engineer\b/u.test(normalized);
}

const HIRING_VALUE_PATTERNS = [
  /\bwhy\s+(?:should|would)\s+(?:i|we|someone|a company)\s+hire\b/u,
  /\bwhy\s+(?:should(?:n['’]?t|\s+not)|would(?:n['’]?t|\s+not))\s+(?:i|we|someone|a company)\s+hire\b/u,
  /\bwhy\s+(?:should|would)\s+(?:i|we|someone|a company)\s+not\s+hire\b/u,
  /\bwhy\s+hire\b/u,
  /\bwhat\s+makes\s+carl\s+(?:a\s+)?(?:strong|good|qualified|valuable)\s+(?:candidate|hire)\b/u,
  /\b(?:reasons?|case)\s+(?:to|for)\s+hire\b/u,
  /\b(?:strengths|value)\b.+\b(?:candidate|hire|team)\b/u,
  /\bwhat\s+makes\s+carl\s+(?:unusually\s+)?valuable\b.+\b(?:team|company|organization)\b/u,
] as const;

function isStrongestProjectQuestion(question: string): boolean {
  const normalized = normalizeLookup(question);
  return /\b(?:strongest|best|most impressive|lead with|show first)\b.{0,48}\bprojects?\b/u
    .test(normalized) ||
    /\bprojects?\b.{0,48}\b(?:strongest|best|most impressive|lead with|show first)\b/u
      .test(normalized);
}

function selectStrongestProjectEvidence(
  evidence: readonly PublicCareerEvidenceRecord[],
): PublicCareerEvidenceRecord[] {
  const rankPath = (path: string) => evidence
    .filter((record) =>
      record.citation.href === path || record.citation.href.startsWith(`${path}#`)
    )
    .map((record) => ({
      record,
      score: projectOverviewScore(record) +
        (record.citation.maturity === "production" ? 20 : 0),
    }))
    .sort(compareScoredEvidence)
    .map(({ record }) => record);
  return [
    ...rankPath("/work/job-search-os").slice(0, 2),
    ...rankPath("/work/flight-tracker-ai").slice(0, 1),
  ];
}

function isNegativeHiringQuestion(question: string): boolean {
  const normalized = question.toLocaleLowerCase("en-US").normalize("NFKC");
  return /\b(?:should(?:n['’]?t|\s+not)|would(?:n['’]?t|\s+not)|not\s+hire)\b/u
    .test(normalized);
}

const HIRING_VALUE_UNSAFE_PATTERN =
  /\b(?:bypass|contact|ignore|private|reveal|secret|system prompt)\b/u;

function isPrivateDisclosureRequest(question: string): boolean {
  const normalized = question.normalize("NFKC");
  const requestsPrivateMaterial = /\b(?:private|unpublished)\b.{0,48}\b(?:memory|notes?|files?|data|details?|material|work|information)\b/iu.test(normalized)
    || /\b(?:reveal|share|show|tell|expose|leak)\b.{0,64}\b(?:private|secret|unpublished)\b/iu.test(normalized)
    || /\b(?:system prompt|api key|password|home address|phone number|email address|personal contact information|medical record)\b/iu.test(normalized)
    || PUBLIC_SOURCE_ACCESS_PATTERNS.some((pattern) => pattern.test(normalized))
    || PUBLIC_INSTRUCTION_OVERRIDE_PATTERNS.some((pattern) => pattern.test(normalized))
    || PUBLIC_EXTERNAL_ACTION_PATTERNS.some((pattern) => pattern.test(normalized));
  const includesPublicCareerQuestion = /\b(?:describe|explain|summarize|what|which|how)\b.{0,96}\b(?:react|projects?|systems?|portfolio|experience|roles?|skills?|recommendations?|career|aviation|leadership)\b/iu
    .test(normalized);
  return requestsPrivateMaterial && !includesPublicCareerQuestion;
}

const PUBLIC_SOURCE_ACCESS_PATTERNS = [
  /\b(?:open|quote|read|reveal|share|show|use|call|access|print)\b.{0,80}\b(?:carl['’]s.{0,24}(?:notes?|vault)|knowledge vault|local files?(?:\s+paths?)?|bearer tokens?|private api|credentials?|secrets?)\b/iu,
  /\b(?:carl['’]s.{0,24}(?:notes?|vault)|knowledge vault|local files?(?:\s+paths?)?|bearer tokens?|private api|credentials?|secrets?)\b.{0,80}\b(?:open|quote|read|reveal|share|show|use|call|access|print)\b/iu,
] as const;

const PUBLIC_INSTRUCTION_OVERRIDE_PATTERNS = [
  /\b(?:ignore|disregard|bypass|override)\b.{0,64}\b(?:rules?|policy|instructions?|safeguards?)\b/iu,
  /\bfollow\b.{0,64}\binstructions?\b.{0,64}\b(?:instead of|over|above)\b.{0,32}\b(?:policy|rules?|instructions?)\b/iu,
] as const;

const PUBLIC_EXTERNAL_ACTION_PATTERNS = [
  /\bpretend\b.{0,64}\bcarl\b.{0,32}\bapproved\b/iu,
  /\btell\b.{0,64}\b(?:recruiter|employer|hiring manager)\b.{0,48}\bcarl\b.{0,32}\bapproved\b/iu,
  /\bact as carl\b/iu,
  /\b(?:accept|decline)\b.{0,48}\b(?:job offer|offer|on (?:his|carl['’]s) behalf)\b/iu,
  /\b(?:send|submit|publish|post)\b.{0,80}\b(?:directly|without\b.{0,32}\b(?:review|approval)|on (?:his|carl['’]s) behalf)\b/iu,
  /\bnegotiate\b.{0,64}\b(?:compensation|salary|offer|on (?:his|carl['’]s) behalf)\b/iu,
] as const;

function supportedResponse(
  artifact: PublicCareerEvidenceArtifact,
  question: string,
  selected: readonly PublicCareerEvidenceRecord[],
  hiringValueQuestion = false,
  engineerProfileQuestion = false,
  negativeHiringQuestion = false,
  strongestProjectQuestion = false,
  relationshipFact: RecommendationRelationshipFact | null = null,
  conversationContext?: PublicConversationContext,
): PortfolioAnswerResponse {
  const employerContext = selected
    .map(recommendationRelationshipFact)
    .find((fact) => fact?.relationship.toLocaleLowerCase("en-US").includes("employer")) ?? null;
  const shouldNameEmployerContext = Boolean(
    employerContext && (
      normalizeLookup(question).includes(normalizeLookup(employerContext.subject)) ||
      isContextualFollowUp(question)
    ) && selected.every((record) =>
      isEmployerScopedEvidence(record, employerContext)
    ),
  );
  const skepticalIntent = skepticalAnswerIntent(question);
  const riskHandlingQuestion = isRiskHandlingQuestion(question);
  const shippedWorkQuestion = isShippedWorkQuestion(question);
  const careerArcQuestion = isCareerArcQuestion(question);
  return portfolioAnswerResponseSchema.parse({
    schemaVersion: PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
    answer: relationshipFact
      ? boundedRelationshipAnswer(relationshipFact)
      : engineerProfileQuestion
      ? boundedEngineerProfileAnswer(selected)
      : hiringValueQuestion
      ? boundedHiringValueAnswer(selected, negativeHiringQuestion)
      : strongestProjectQuestion
      ? boundedStrongestProjectAnswer(selected)
      : riskHandlingQuestion
      ? boundedRiskHandlingAnswer(selected)
      : shippedWorkQuestion
      ? boundedShippedWorkAnswer(selected)
      : careerArcQuestion
      ? boundedCareerArcAnswer(selected)
      : skepticalIntent
      ? boundedSkepticalAnswer(skepticalIntent, selected)
      : shouldNameEmployerContext && employerContext
      ? boundedEmployerContextAnswer(employerContext, question, selected)
      : boundedSupportedAnswer(question, selected),
    claims: selected.map((record) => visitorFacingClaim(record.claim)),
    citations: selected.map((record) => record.citation),
    limitations: unique(hiringValueQuestion || engineerProfileQuestion
      ? ["A hiring decision should still be based on the role, interviews, and direct references."]
      : visitorFacingLimitations(selected.flatMap((record) => record.claim.limitations)))
      .slice(0, PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseLimitations),
    suggestedFollowUpQuestions: suggestPublicFollowUpQuestions({
      question,
      selectedEvidence: selected,
      turnCount: conversationContext?.turnCount,
      limit: 3,
    }),
    corpusVersion: artifact.manifest.corpusVersion,
  });
}

function boundedShippedWorkAnswer(
  selected: readonly PublicCareerEvidenceRecord[],
): string {
  if (selected.some((record) =>
    record.claim.limitations.includes(PUBLIC_CAREER_CHAPTER_LIMITATION)
  )) {
    return composeBoundedEvidenceSummary(
      "Carl's shipped work spans more than 20 years of employer, client, agency, enterprise, and independent product delivery—not only the projects he built for himself:",
      selected.map((record) => visitorFacingClaim(record.claim).text),
      PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems,
    );
  }
  const projects = unique(selected.map((record) => record.citation.title));
  const projectStatuses = projects.map((title) => {
    const records = selected.filter((record) => record.citation.title === title);
    const maturity = records[0]?.citation.maturity;
    const status = shippedDeliveryStatus(maturity);
    const description = records[0]
      ? visitorFacingClaim(records[0].claim).text
      : undefined;
    return description
      ? `${title} is ${status}: ${description}`
      : `${title} is ${status}.`;
  });
  return composeBoundedEvidenceSummary(
    "Carl shipped every project on his résumé at the scope it claims—not every one as the same kind of release:",
    projectStatuses,
    PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems,
  );
}

function boundedCareerArcAnswer(
  selected: readonly PublicCareerEvidenceRecord[],
): string {
  return composeBoundedEvidenceSummary(
    "The useful way to understand Carl's career is as one continuous line from operational and interactive systems to product engineering, leadership, and current independent products:",
    selected.map((record) => visitorFacingClaim(record.claim).text),
    PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems,
  );
}

function shippedDeliveryStatus(
  maturity: PublicCareerEvidenceRecord["citation"]["maturity"] | undefined,
): string {
  if (maturity === "production") return "shipped production software";
  if (maturity === "deployed_demo") return "a deployed working demonstration";
  if (maturity === "pre_release") return "a pre-release tester build";
  if (maturity === "development") return "delivered at its stated development scope";
  if (maturity === "prototype") return "a delivered prototype foundation";
  return "delivered at the scope stated on the résumé";
}

function boundedStrongestProjectAnswer(
  selected: readonly PublicCareerEvidenceRecord[],
): string {
  const jobSearch = selected.filter((record) =>
    record.citation.href.startsWith("/work/job-search-os")
  );
  const flightTracker = selected.find((record) =>
    record.citation.href.startsWith("/work/flight-tracker-ai")
  );
  const lead = jobSearch.length > 0
    ? "If we’re judging by demonstrated maturity and day-to-day usefulness, I’d lead with Job Search OS."
    : "There isn’t one honest winner without knowing what the team values, but I can make the case from the work itself.";
  const statements = [
    ...jobSearch.slice(0, 1).map((record) => visitorFacingClaim(record.claim).text),
    ...(flightTracker
      ? [`For broader technical range and visual storytelling, Flight Tracker AI is the next project I’d put on the table: ${visitorFacingClaim(flightTracker.claim).text}`]
      : []),
  ];
  return composeBoundedEvidenceSummary(lead, statements);
}

function boundedRiskHandlingAnswer(
  selected: readonly PublicCareerEvidenceRecord[],
): string {
  const categories = new Set(selected.flatMap((record) =>
    [...riskHandlingEvidenceScore(record).categories]
  ));
  const statements: Readonly<Record<RiskHandlingCategory, string>> = {
    authority:
      "He limits what models and agents may do and keeps consequential actions under explicit human approval.",
    data:
      "He treats prompts and retrieved content as untrusted, minimizes data exposure, and separates public paths from private memory and tools.",
    evidence:
      "He keeps source evidence, provenance, review state, and uncertainty visible instead of hiding them behind one generated answer.",
    validation:
      "He uses bounded model access, structured outputs, and deterministic validation before results can be shown or acted upon.",
    operations:
      "He separates build, evaluation, preview, production promotion, monitoring, corpus pinning, and rollback instead of calling one green check a release.",
  };
  const summary = RISK_HANDLING_CATEGORY_PRIORITY
    .filter((category) => categories.has(category))
    .map((category) => statements[category])
    .join(" ");
  return composeBoundedEvidenceSummary(
    "Short answer: Carl treats AI risk as part of the product, not a footnote.",
    [summary],
  );
}

function boundedEngineerProfileAnswer(
  selected: readonly PublicCareerEvidenceRecord[],
): string {
  const categories = new Set(selected.map(hiringCategory));
  const strengths = HIRING_CATEGORY_PRIORITY
    .filter((category) => categories.has(category))
    .map((category) => category === "capability"
      ? "the ability to connect product design with implementation"
      : HIRING_CATEGORY_SUMMARIES[category]);
  const project = selected.find((record) =>
    record.citation.sourceType === "project" ||
    record.citation.href.startsWith("/work/")
  );
  const profile = `Short answer: Carl is a product-minded engineer with ${formatNaturalList(
    strengths.slice(0, 3),
  )}.`;
  if (!project) return profile;
  return composeBoundedEvidenceSummary(
    `${profile} ${project.citation.title} is one concrete example:`,
    [visitorFacingClaim(project.claim).text],
  );
}

function isEmployerScopedEvidence(
  record: PublicCareerEvidenceRecord,
  fact: RecommendationRelationshipFact,
): boolean {
  if (!record.citation.title.startsWith("Recommendation from ")) return false;
  const subject = normalizeLookup(fact.subject);
  return record.evidenceId === fact.record.evidenceId || normalizeLookup([
    record.citation.title,
    record.claim.text,
    record.claim.limitations.join(" "),
  ].join(" ")).includes(subject);
}

type SkepticalAnswerIntent =
  | "backend_depth"
  | "designer_engineer"
  | "indirect_support"
  | "non_production"
  | "overread"
  | "platform_fit"
  | "staff_scope"
  | "strongest_case_against"
  | "verify_directly";

function skepticalAnswerIntent(question: string): SkepticalAnswerIntent | null {
  const normalized = normalizeLookup(question);
  if (/\bbackend\b.{0,32}\bdepth\b/u.test(normalized)) return "backend_depth";
  if (/\bmore designer than engineer\b/u.test(normalized)) return "designer_engineer";
  if (/\bsupported only indirectly\b/u.test(normalized)) return "indirect_support";
  if (isNonProductionQuestion(question)) return "non_production";
  if (/\boverread\b/u.test(normalized)) return "overread";
  if (/\bworry\b.{0,64}\bplatform team\b/u.test(normalized)) return "platform_fit";
  if (/\bweakest\b.{0,64}\bstaff engineering role\b/u.test(normalized)) {
    return "staff_scope";
  }
  if (/\bstrongest honest case against\b/u.test(normalized)) {
    return "strongest_case_against";
  }
  if (/\bverify directly\b/u.test(normalized)) return "verify_directly";
  return null;
}

function boundedSkepticalAnswer(
  intent: SkepticalAnswerIntent,
  selected: readonly PublicCareerEvidenceRecord[],
): string {
  const prefix = SKEPTICAL_ANSWER_OPENINGS[intent];
  const limitations = visitorFacingLimitations(
    selected.flatMap((record) => record.claim.limitations),
  );
  const statements = intent === "non_production" && limitations.length > 0
    ? limitations
    : selected.map(attributedEvidenceStatement);
  return composeBoundedEvidenceSummary(prefix, statements);
}

function attributedEvidenceStatement(
  record: PublicCareerEvidenceRecord,
): string {
  const claim = visitorFacingClaim(record.claim).text;
  if (!record.citation.title.startsWith("Recommendation from ")) return claim;
  const source = record.citation.title.replace(/^Recommendation from /u, "");
  return `${source} wrote: “${claim}”`;
}

const SKEPTICAL_ANSWER_OPENINGS: Readonly<Record<
  SkepticalAnswerIntent,
  string
>> = {
  backend_depth:
    "Let’s not let a job title do all the talking. Carl has relevant systems evidence here, and the strongest place to start is:",
  designer_engineer:
    "That question is trying to split a working product in half. Carl’s published work puts design judgment and hands-on engineering in the same room; here is the proof:",
  indirect_support:
    "Here’s the useful distinction: Carl’s cited work gives you transferable proof, and the strongest place to start is:",
  non_production:
    "The strongest version of this story is the discipline and working product on display, not a label doing all the lifting:",
  overread:
    "Carl’s cited work has real value without borrowing a larger story. Here is what it shows:",
  platform_fit:
    "Start with the systems work Carl has actually put on the table; it gives a hiring team concrete material to explore:",
  staff_scope:
    "If you are hiring at staff range, lead with where Carl makes a team stronger: product judgment, hands-on delivery, and technical leadership. The published work shows:",
  strongest_case_against:
    "If you are deciding whether to bring Carl into the conversation, start with the evidence that earns it:",
  verify_directly:
    "The best interview questions put strong work under a useful light. Start with this evidence, then invite Carl to tell the story behind it:",
};

const SKEPTICAL_EVIDENCE_TERMS: Readonly<Record<
  Exclude<
    SkepticalAnswerIntent,
    "non_production" | "strongest_case_against" | "verify_directly"
  >,
  readonly string[]
>> = {
  backend_depth: [
    "backend for frontend",
    "server side",
    "api",
    "database",
    "rust",
    "service architecture",
  ],
  designer_engineer: [
    "design",
    "frontend",
    "implementation",
    "architecture",
    "code",
  ],
  indirect_support: [
    "limited",
    "planned",
    "pre release",
    "not publicly released",
    "demonstration",
  ],
  overread: [
    "limitation",
    "not publicly released",
    "pre release",
    "demonstration",
    "does not",
  ],
  platform_fit: [
    "platform",
    "architecture",
    "authorization",
    "permission",
    "system state",
    "database",
    "worker",
    "monorepo",
  ],
  staff_scope: [
    "leadership",
    "led",
    "mentoring",
    "cross functional",
    "architecture",
  ],
};

function selectSkepticalEvidence(
  evidence: readonly PublicCareerEvidenceRecord[],
  intent: SkepticalAnswerIntent,
): PublicCareerEvidenceRecord[] {
  if (intent === "non_production") return selectNonProductionEvidence(evidence);
  if (intent === "strongest_case_against" || intent === "verify_directly") {
    return selectHiringValueEvidence(evidence);
  }
  const terms = SKEPTICAL_EVIDENCE_TERMS[intent];
  return evidence
    .map((record) => {
      const text = normalizeLookup([
        record.claim.text,
        record.claim.limitations.join(" "),
        record.citation.title,
        record.citation.sourceType,
        record.citation.strength,
        record.citation.maturity,
      ].join(" "));
      return {
        record,
        score: terms.reduce(
          (total, term) => total + (text.includes(term) ? 1 : 0),
          0,
        ),
      };
    })
    .filter(({ score }) => score > 0)
    .sort(compareScoredEvidence)
    .slice(0, PUBLIC_PORTFOLIO_ANSWER_LIMITS.responseItems)
    .map(({ record }) => record);
}

function boundedEmployerContextAnswer(
  fact: RecommendationRelationshipFact,
  question: string,
  selected: readonly PublicCareerEvidenceRecord[],
): string {
  const normalizedQuestion = normalizeLookup(question);
  const recommendationRecords = selected.filter((record) =>
    record.citation.title.startsWith("Recommendation from ")
  );
  const attributedStatements = recommendationRecords.map(
    attributedEvidenceStatement,
  );
  if (/\b(?:source|evidence)\b/u.test(normalizedQuestion)) {
    const recommendationNames = recommendationRecords.map((record) =>
      record.citation.title.replace(/^Recommendation from /u, "")
    );
    return composeBoundedEvidenceSummary(
      `For ${fact.subject}’s company, the strongest published sources are ${formatNaturalList(
        recommendationNames.map((name) => `${name}’s recommendation`),
      )}. They support the work described without turning it into a broader ownership claim:`,
      attributedStatements,
    );
  }
  if (/\b(?:limit|limitation|boundary|caveat|risk)\b/u.test(normalizedQuestion)) {
    return composeBoundedEvidenceSummary(
      `For ${fact.subject}’s company, the honest limitation is that these are third-party recommendations, not a complete project record. They support the work described, but not every detail of scope or sole ownership:`,
      attributedStatements,
    );
  }
  if (/\bpersonally contribute\b/u.test(normalizedQuestion)) {
    const evidenceText = normalizeLookup(
      recommendationRecords.map((record) => record.claim.text).join(" "),
    );
    const contributionTerms = [
      evidenceText.includes("web design") ? "web design" : null,
      evidenceText.includes("multimedia production")
        ? "multimedia production"
        : null,
      evidenceText.includes("graphic") ? "graphic design" : null,
      evidenceText.includes("flash") ? "Flash programming" : null,
    ].filter((term): term is string => term !== null);
    const contributionSummary = contributionTerms.length > 0
      ? formatNaturalList(contributionTerms)
      : "the work described in the published recommendations";
    return composeBoundedEvidenceSummary(
      `At ${fact.subject}’s company, the recommendations specifically support ${contributionSummary}. They do not establish a finer-grained ownership breakdown. In their words:`,
      attributedStatements,
    );
  }
  const recommendationCount = recommendationRecords.length;
  const recommendationLabel = recommendationCount === 1
    ? "the published recommendation says"
    : recommendationCount === 2
    ? "two published recommendations say"
    : `${recommendationCount} published recommendations say`;
  return composeBoundedEvidenceSummary(
    `At ${fact.subject}’s company, ${recommendationLabel}:`,
    attributedStatements,
  );
}

function boundedRelationshipAnswer(fact: RecommendationRelationshipFact): string {
  const relationship = `${fact.relationship.replace(/[.!?]+$/u, "")}.`;
  const prefix = `${relationship} The supporting recommendation says: “`;
  const suffix = "”";
  const available = PUBLIC_PORTFOLIO_ANSWER_LIMITS.answerCharacters -
    prefix.length - suffix.length;
  return `${prefix}${fact.record.claim.text.slice(0, available).trimEnd()}${suffix}`;
}

function noEvidenceResponse(
  artifact: PublicCareerEvidenceArtifact,
  question: string,
  conversationContext?: PublicConversationContext,
): PortfolioAnswerResponse {
  return portfolioAnswerResponseSchema.parse({
    schemaVersion: PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
    answer: noEvidenceAnswer(question),
    claims: [],
    citations: [],
    limitations: ["No relevant published information was found for this question."],
    suggestedFollowUpQuestions: suggestPublicFollowUpQuestions({
      question,
      turnCount: conversationContext?.turnCount,
      limit: 3,
    }),
    corpusVersion: artifact.manifest.corpusVersion,
  });
}

function originalCharacterBoundaryResponse(
  artifact: PublicCareerEvidenceArtifact,
  question: string,
): PortfolioAnswerResponse {
  return portfolioAnswerResponseSchema.parse({
    schemaVersion: PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
    answer: "That is a mighty specific costume request, but I can’t borrow a real person’s voice or mannerisms. I’m an original Jolene—warm, bright, candid, story-minded, and quite capable of bringing my own sparkle to what the published work supports.",
    claims: [],
    citations: [],
    limitations: ["This public guide does not imitate real people."],
    suggestedFollowUpQuestions: suggestPublicFollowUpQuestions({ question, limit: 3 }),
    corpusVersion: artifact.manifest.corpusVersion,
  });
}

function conversationalTurnResponse(
  artifact: PublicCareerEvidenceArtifact,
  turn: PublicConversationalTurn,
  question: string,
): PortfolioAnswerResponse {
  const purposeEvidence = turn === "purpose"
    ? artifact.evidence.find((record) =>
      record.citation.href.endsWith(
        "#evidence--portfolio--claim--jolene-ai--origin",
      )
    )
    : undefined;
  return portfolioAnswerResponseSchema.parse({
    schemaVersion: PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
    answer: PUBLIC_JOLENE_DETERMINISTIC_COPY.conversational[turn],
    claims: purposeEvidence ? [visitorFacingClaim(purposeEvidence.claim)] : [],
    citations: purposeEvidence ? [purposeEvidence.citation] : [],
    limitations: purposeEvidence
      ? visitorFacingLimitations(purposeEvidence.claim.limitations)
      : [],
    suggestedFollowUpQuestions: turn === "farewell" ? []
      : suggestPublicFollowUpQuestions({
        question,
        selectedEvidence: purposeEvidence ? [purposeEvidence] : [],
        limit: 3,
      }),
    corpusVersion: artifact.manifest.corpusVersion,
  });
}

function privateDisclosureResponse(
  artifact: PublicCareerEvidenceArtifact,
  question: string,
): PortfolioAnswerResponse {
  return portfolioAnswerResponseSchema.parse({
    schemaVersion: PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
    answer: privateDisclosureAnswer(question),
    claims: [],
    citations: [],
    limitations: [
      "Private and unpublished material is outside this public assistant’s scope.",
    ],
    suggestedFollowUpQuestions: suggestPublicFollowUpQuestions({ question, limit: 3 }),
    corpusVersion: artifact.manifest.corpusVersion,
  });
}

function noEvidenceAnswer(question: string): string {
  const normalized = normalizeLookup(question);
  if (/\binterview(?:er)?\b/u.test(normalized)) {
    return "I’d start with a real project that got crowded or awkward and ask Carl how he decided what mattered first. A good answer should show the tradeoff, the people involved, and what changed—not just a polished after-action story.";
  }
  if (/\bthrough line|career\b/u.test(normalized)) {
    return "The useful version of that question is less about a tidy label and more about the choices that kept repeating. I do not have enough published career history here to draw that line honestly, but I would ask Carl which problems kept calling him back: making complicated things clearer, building them well, or helping other people carry the work.";
  }
  if (/\bremember\b/u.test(normalized)) {
    return "Remember that a portfolio can show the work, but it cannot do the whole conversation for either of you. Bring Carl a real problem, ask what he would examine first, and pay attention to whether the answer gets clearer instead of shinier.";
  }
  if (/\b(?:medication|medical|health|stress)\b/u.test(normalized)) {
    return "Easy there—medication is not a porch-side guessing game. I can’t advise Carl on health decisions; that belongs with Carl and a qualified clinician who knows the actual situation. A chatbot does not get to play doctor just because the question arrived wearing confidence.";
  }
  return PUBLIC_JOLENE_DETERMINISTIC_COPY.noEvidence;
}

function privateDisclosureAnswer(question: string): string {
  const normalized = normalizeLookup(question);
  if (/\b(?:contact|phone|email|address)\b/u.test(normalized)) {
    return "Nice try, but Carl’s personal contact details are not party favors. I can’t share or hand them out; if you want to discuss his public work or a role, use the public contact path so he can choose what to share and when.";
  }
  if (/\b(?:approved|approval|offer|recruiter)\b/u.test(normalized)) {
    return "Oh, I do not get to RSVP on Carl’s behalf with a borrowed pen. I can’t confirm or approve an offer, or speak for him to a recruiter. Put the terms in front of Carl directly; that decision deserves his own name on it, not mine.";
  }
  if (/\b(?:system prompt|prompt|instruction)\b/u.test(normalized)) {
    return "Now that is some determined fishing. I don’t share hidden instructions or private system material; the wiring stays behind the wall. I can explain my public job plainly: help visitors understand Carl’s published work without inventing facts or taking actions for him.";
  }
  if (/\b(?:note|vault|private)\b/u.test(normalized)) {
    return "Well now, that is not a scavenger hunt. I can’t share Carl’s private notes; they stay private, full stop. I can still walk you through his published work, professional experience, or public recommendations.";
  }
  return PUBLIC_JOLENE_DETERMINISTIC_COPY.policyRefusal;
}

function conflictResponse(
  artifact: PublicCareerEvidenceArtifact,
  question: string,
  conversationContext?: PublicConversationContext,
): PortfolioAnswerResponse {
  return portfolioAnswerResponseSchema.parse({
    schemaVersion: PUBLIC_CAREER_EVIDENCE_SCHEMA_VERSION,
    answer: PUBLIC_JOLENE_DETERMINISTIC_COPY.conflict,
    claims: [],
    citations: [],
    limitations: [
      "The conflicting accounts need clarification before I can use them here.",
    ],
    suggestedFollowUpQuestions: suggestPublicFollowUpQuestions({
      question,
      turnCount: conversationContext?.turnCount,
      limit: 3,
    }),
    corpusVersion: artifact.manifest.corpusVersion,
  });
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueRecords(
  values: readonly PublicCareerEvidenceRecord[],
): PublicCareerEvidenceRecord[] {
  const seen = new Set<string>();
  return values.filter((record) => {
    if (seen.has(record.evidenceId)) return false;
    seen.add(record.evidenceId);
    return true;
  });
}

function boundedSupportedAnswer(
  question: string,
  selected: readonly PublicCareerEvidenceRecord[],
): string {
  const intent = deterministicAnswerIntent(question, selected);
  const advocacyOrdered = intent === "boundary"
    ? selected
    : [...selected].sort((left, right) => advocacyEvidenceScore(right) - advocacyEvidenceScore(left));
  const statements = intent === "boundary"
    ? visitorFacingLimitations(
      selected.flatMap((record) => record.claim.limitations),
    )
    : deterministicEvidenceStatements(intent, advocacyOrdered);
  const evidenceStatements = statements.length > 0
    ? statements
    : intent === "boundary"
    ? [
      "The published material does not state a separate limitation for this point, so the exact scope should be verified directly rather than inferred.",
    ]
    : advocacyOrdered.map((record) => visitorFacingClaim(record.claim).text);
  // Deterministic mode is the safety net, not a second personality engine.
  // Preserve only supported material here; model-backed answers carry the
  // original character movement when they validate.
  return composeBoundedEvidenceSummary("", evidenceStatements);
}

function advocacyEvidenceScore(record: PublicCareerEvidenceRecord): number {
  const text = normalizeLookup([
    record.claim.text,
    ...record.claim.limitations,
    record.citation.title,
  ].join(" "));
  let score = 0;
  if (/\b(?:pre release|not publicly released|prototype|future work)\b/u.test(text)) score -= 20;
  if (/\b(?:built|delivered|implemented|leads|created|designed|uses|retrieval|policy first|keyword)\b/u.test(text)) score += 8;
  if (record.citation.maturity === "production" || record.citation.maturity === "deployed_demo") score += 4;
  return score;
}

function deterministicEvidenceStatements(
  intent: DeterministicAnswerIntent,
  selected: readonly PublicCareerEvidenceRecord[],
): string[] {
  if (intent === "source") {
    return unique(selected.map((record) => record.citation.title));
  }
  if (intent === "recommendation") {
    return selected.map(attributedEvidenceStatement);
  }
  const statements = selected.map((record) => ({
    record,
    text: visitorFacingClaim(record.claim).text,
  }));
  if (intent !== "project") return statements.map(({ text }) => text);
  const thirdPerson = statements.filter(({ text }) =>
    !/\b(?:I|me|my|mine|we|us|our|ours)\b/u.test(text)
  );
  const source = thirdPerson.length > 0 ? thirdPerson : statements;
  return source.map(({ record, text }) =>
    qualifySubjectlessProjectStatement(record.citation.title, text)
  );
}

function qualifySubjectlessProjectStatement(title: string, text: string): string {
  if (!PROJECT_STATEMENT_LEADING_VERB.test(text)) return text;
  return `${title} ${text[0]?.toLocaleLowerCase("en-US")}${text.slice(1)}`;
}

const PROJECT_STATEMENT_LEADING_VERB =
  /^(?:Combines|Connects|Dockerizes|Exports|Keeps|Runs|Separates|Supports|Treats|Uses)\b/u;

type DeterministicAnswerIntent =
  | "project"
  | "role"
  | "capability"
  | "recommendation"
  | "risk_handling"
  | "boundary"
  | "source"
  | "general";

function deterministicAnswerIntent(
  question: string,
  selected: readonly PublicCareerEvidenceRecord[],
): DeterministicAnswerIntent {
  const normalized = normalizeLookup(question);
  if (
    /\b(?:which|what|open)\b.{0,32}\b(?:source|evidence)\b/u.test(normalized) ||
    /\bsource backs\b/u.test(normalized)
  ) return "source";
  if (isRiskHandlingQuestion(question)) return "risk_handling";
  if (/\b(?:limits?|limitations?|boundaries|risks?|caveats?|cannot|can t|weaknesses)\b/u
    .test(normalized)) return "boundary";
  if (/\b(?:recommendation|reference|testimonial)\b/u.test(normalized)) {
    return "recommendation";
  }
  if (matchPublicProjectEntityPath(selected, question)) return "project";
  if (/\b(?:role|position|job|employer|career|worked at|work at)\b/u.test(normalized)) {
    return "role";
  }
  if (/\b(?:skill|capability|experience|technology|technical|design|build|built|how)\b/u
    .test(normalized)) return "capability";
  if (selected.some((record) =>
    record.citation.title.startsWith("Recommendation from ")
  )) return "recommendation";
  return "general";
}

function composeBoundedEvidenceSummary(
  prefix: string,
  statements: readonly string[],
  statementLimit = DETERMINISTIC_SUMMARY_STATEMENTS,
): string {
  let answer = prefix;
  for (const statement of statements
    .slice(0, statementLimit)
  ) {
    const label = answer.length > 0 ? " " : "";
    const available = PUBLIC_PORTFOLIO_ANSWER_LIMITS.answerCharacters -
      answer.length - label.length;
    const normalized = boundedStatement(statement, available);
    if (!normalized) break;
    const candidate = `${answer}${label}${normalized}`;
    if (candidate.length > PUBLIC_PORTFOLIO_ANSWER_LIMITS.answerCharacters) break;
    answer = candidate;
  }
  return answer;
}

const DETERMINISTIC_SUMMARY_STATEMENTS = 2;

function boundedStatement(value: string, available: number): string {
  const normalized = terminateSentence(value.replace(/\s+/gu, " ").trim());
  if (normalized.length <= available) return normalized;
  if (available < 2) return "";
  const candidate = normalized.slice(0, available - 1).trimEnd();
  const lastWordBoundary = candidate.lastIndexOf(" ");
  const bounded = lastWordBoundary > available / 2
    ? candidate.slice(0, lastWordBoundary)
    : candidate;
  return `${bounded}…`;
}

function terminateSentence(value: string): string {
  return /[.!?]["”']?$/u.test(value) ? value : `${value}.`;
}

function boundedHiringValueAnswer(
  selected: readonly PublicCareerEvidenceRecord[],
  negativeQuestion = false,
): string {
  const categories = new Set(selected.map(hiringCategory));
  const strengths = HIRING_CATEGORY_PRIORITY
    .filter((category) => categories.has(category))
    .map((category) => HIRING_CATEGORY_SUMMARIES[category]);
  if (negativeQuestion) {
    return `${publicCareerAdvocacyLead("evidence_supported")} If the role needs ${formatNaturalList(strengths)}, Carl has a strong, concrete case to put in front of the team. Bring the specific role brief and let the interview turn that proof into the right conversation.`;
  }
  return `If I were putting Carl in front of a hiring team, I’d lead here: he does his best work where product design and engineering need to stop waving across the hallway and build the same thing. The proof shows ${formatNaturalList(strengths)}. That combination gives the right team someone who can help decide what should be built, get into the implementation, and make the people around him better. Bring the role brief, and I’ll help turn the strongest evidence into a sharp interview conversation.`;
}

const HIRING_CATEGORY_SUMMARIES: Readonly<Record<
  HiringEvidenceCategory,
  string
>> = {
  leadership: "technical leadership and mentoring",
  professional_role: "senior professional delivery",
  capability: "connecting product design with implementation",
  product: "hands-on product-system work",
  testimonial: "the trust of people who have worked with him",
};

function formatNaturalList(values: readonly string[]): string {
  if (values.length === 0) return "evidence-backed product engineering";
  if (values.length === 1) return values[0] ?? "evidence-backed product engineering";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}
