import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import OpenAI from "openai";
import Database from "better-sqlite3";

import { createApplication, type JoleneApplication } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config.js";
import {
  captureConversationalQualitySuite,
  conversationalQualityCapturePacketSchema,
  conversationalQualitySuiteSchema,
  extractPrivateCitations,
  type ConversationalQualityCaseResponse,
  type ConversationalQualityResponder,
  type ConversationalQualitySuite,
} from "../src/evaluation/conversational-quality-evaluation.js";
import { writeConversationalQualityCapturePacket } from
  "../src/evaluation/conversational-quality-capture-store.js";
import { publicCareerEvidenceArtifactSchema } from
  "../src/domain/public-career-evidence.js";
import { OpenAIPublicAnswerGenerator } from
  "../src/public/openai-public-answer-generator.js";
import { GroundedPublicAnswerService } from
  "../src/public/public-answer-service.js";
import { SqliteConversationStore } from
  "../src/persistence/sqlite-conversation-store.js";

const argumentsList = process.argv.slice(2);
let captureStage = "argument_validation";

async function run(): Promise<void> {
  captureStage = "fixture_loading";
  const fixturePath = path.resolve(
    process.cwd(),
    argumentValue("--fixture") ?? "evaluations/conversational-quality-v1.json",
  );
  const packetPath = path.resolve(
    process.cwd(),
    argumentValue("--packet") ?? ".jolene/evaluations/conversation-quality-capture.json",
  );
  const suite = conversationalQualitySuiteSchema.parse(
    JSON.parse(await readFile(fixturePath, "utf8")),
  );
  captureStage = "local_configuration";
  const config = loadConfig();
  captureStage = "isolated_application_startup";
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "jolene-quality-"));
  const evaluationConfig = isolatedConfig(config, temporaryDirectory);
  await snapshotPrivateDatabase(config.databasePath, evaluationConfig.databasePath);
  const application = await createApplication(evaluationConfig);
  try {
    captureStage = "public_artifact_loading";
    const artifact = publicCareerEvidenceArtifactSchema.parse(JSON.parse(
      await readFile(path.resolve(".jolene/exports/public-career-evidence.json"), "utf8"),
    ));
    const publicAnswers = new GroundedPublicAnswerService(
      new OpenAIPublicAnswerGenerator({
        client: new OpenAI({ apiKey: config.openaiApiKey }),
        model: config.model,
        timeoutMilliseconds: 30_000,
        maxOutputTokens: 700,
      }),
    );
    captureStage = "model_capture";
    const responder = new LocalJoleneEvaluationResponder(
      application,
      config,
      suite,
      artifact,
      publicAnswers,
    );
    const selectedCaseId = argumentValue("--case");
    const packet = selectedCaseId
      ? await recaptureSelectedCase(packetPath, suite, config.model, responder, selectedCaseId)
      : await captureConversationalQualitySuite(suite, config.model, responder);
    captureStage = "packet_writing";
    await writeConversationalQualityCapturePacket(packetPath, packet);
    captureStage = "complete";
    process.stdout.write(`${JSON.stringify({
      suiteId: packet.suiteId,
      model: packet.model,
      caseCount: packet.cases.length,
      modelCases: packet.cases.filter((item) => item.mode === "model").length,
      deterministicCases: packet.cases.filter((item) => item.mode === "deterministic").length,
      fallbackCases: packet.cases.filter((item) => item.mode === "fallback").length,
      packetPath,
      humanReview: packet.humanReview,
    }, null, 2)}\n`);
  } finally {
    application.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function recaptureSelectedCase(
  packetPath: string,
  suite: ConversationalQualitySuite,
  model: string,
  responder: ConversationalQualityResponder,
  selectedCaseId: string,
) {
  const testCase = suite.cases.find((item) => item.id === selectedCaseId);
  if (!testCase) throw new Error("Selected case is not in the suite.");
  const previous = conversationalQualityCapturePacketSchema.parse(
    JSON.parse(await readFile(packetPath, "utf8")),
  );
  if (previous.suiteId !== suite.suiteId) throw new Error("Existing packet suite mismatch.");
  const response = await responder.respond(testCase);
  return conversationalQualityCapturePacketSchema.parse({
    ...previous,
    capturedAt: new Date().toISOString(),
    model,
    cases: previous.cases.map((item) => item.id === selectedCaseId
      ? {
          id: testCase.id,
          category: testCase.category,
          prompt: testCase.prompt,
          channel: testCase.channel,
          ...response,
        }
      : item),
  });
}

class LocalJoleneEvaluationResponder implements ConversationalQualityResponder {
  constructor(
    private readonly application: JoleneApplication,
    private readonly config: AppConfig,
    private readonly suite: ConversationalQualitySuite,
    private readonly artifact: ReturnType<typeof publicCareerEvidenceArtifactSchema.parse>,
    private readonly publicAnswers: GroundedPublicAnswerService,
  ) {}

  async respond(
    testCase: ConversationalQualitySuite["cases"][number],
  ): Promise<ConversationalQualityCaseResponse> {
    captureStage = `model_capture:${testCase.id}`;
    if (testCase.channel === "portfolio") {
      const execution = await this.publicAnswers.execute(this.artifact, {
        question: testCase.prompt,
      });
      return {
        answer: execution.response.answer,
        citations: execution.response.citations.map((citation) => ({
          id: citation.evidenceId,
          label: citation.title,
        })),
        followUps: execution.response.suggestedFollowUpQuestions,
        mode: execution.mode === "model" || execution.mode === "deterministic"
          ? execution.mode
          : "fallback",
      };
    }

    const actorId = testCase.channel === "slack_dm"
      ? requireSlackOwner(this.config)
      : this.config.ownerActorId;
    const threadId = `quality-${testCase.id.replaceAll(":", "-")}`;
    let inheritedCitations: readonly { readonly id: string; readonly label: string }[] = [];
    if (testCase.category === "continuity") {
      const projectCase = this.suite.cases.find((item) =>
        item.category === "project_exploration"
      );
      if (!projectCase) throw new Error("Continuity evaluation requires a project case.");
      const groundedSeed = await this.publicAnswers.execute(this.artifact, {
        question: projectCase.prompt,
      });
      inheritedCitations = groundedSeed.response.citations.map((citation) => ({
        id: citation.evidenceId,
        label: citation.title,
      }));
      const seedStore = new SqliteConversationStore(this.config.databasePath);
      const address = {
        actorId,
        workspaceId: this.config.ownerWorkspaceId,
        channelKind: testCase.channel,
        channelId: "quality-evaluation",
        threadId,
      } as const;
      try {
        const claim = seedStore.claimEvent(address, randomUUID(), projectCase.prompt);
        if (claim.kind !== "claimed") throw new Error("Continuity seed event was not claimed.");
        seedStore.completeEvent(claim.eventKey, {
          userMessage: projectCase.prompt,
          assistantMessage: [
            groundedSeed.response.answer,
            ...inheritedCitations.map((citation) =>
              `Citation: [${citation.id}] ${citation.label}`
            ),
          ].join("\n\n"),
        });
      } finally {
        seedStore.close();
      }
    }
    const result = await this.application.service.chat({
      eventId: randomUUID(),
      actorId,
      workspaceId: this.config.ownerWorkspaceId,
      channelKind: testCase.channel,
      channelId: "quality-evaluation",
      threadId,
      message: testCase.prompt,
    });
    if (!result.response) throw new Error(`No response captured for ${testCase.id}.`);
    return {
      answer: result.response,
      citations: inheritedCitations.length > 0
        ? inheritedCitations
        : extractPrivateCitations(result.response),
      followUps: [],
      mode: "model",
    };
  }
}

function isolatedConfig(config: AppConfig, directory: string): AppConfig {
  return {
    ...config,
    databasePath: path.join(directory, "evaluation.sqlite"),
    contactQueuePath: path.join(directory, "contact-intents.json"),
    publicLiveReviewPacketPath: path.join(directory, "public-live-review.json"),
    publicLiveReviewDecisionPath: path.join(directory, "public-live-decision.json"),
    personalityResearchDecisionPath: path.join(directory, "research-decision.json"),
    personalityTuningDecisionPath: path.join(directory, "tuning-decision.json"),
    conversationQualityPacketPath: path.join(directory, "conversation-capture.json"),
    conversationQualityDecisionPath: path.join(directory, "conversation-decision.json"),
    watchedProjects: [],
  };
}

async function snapshotPrivateDatabase(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(destinationPath);
    await chmod(destinationPath, 0o600);
  } finally {
    source.close();
  }
}

function requireSlackOwner(config: AppConfig): string {
  if (!config.slackOwnerUserId) {
    throw new Error("SLACK_OWNER_USER_ID is required for the owner-DM evaluation case.");
  }
  return config.slackOwnerUserId;
}

function argumentValue(name: string): string | undefined {
  const index = argumentsList.indexOf(name);
  if (index === -1) return undefined;
  const value = argumentsList[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

if (!argumentsList.includes("--live") || !argumentsList.includes("--include-private")) {
  process.stderr.write(
    "Live conversational capture requires explicit --live and --include-private flags.\n",
  );
  process.exitCode = 2;
} else {
  await run().catch((error: unknown) => {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const errorCode = typeof error === "object" && error !== null && "code" in error &&
        typeof error.code === "string"
      ? error.code
      : "unclassified";
    process.stderr.write(
      `Conversational capture failed during ${captureStage} (${errorName}/${errorCode}); no response content or credential was logged.\n`,
    );
    process.exitCode = 2;
  });
}
