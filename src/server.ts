import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { ZodError } from "zod";

import { createApplication } from "./app.js";
import { chatRequestSchema } from "./application/jolene-service.js";
import { loadConfig } from "./config.js";
import { ActionProposalPolicyError } from "./application/action-approval-service.js";
import { CareerEvidenceScopeError } from "./application/career-evidence-service.js";
import { ContactIntentReviewScopeError } from "./application/contact-intent-review-service.js";
import {
  ActionApprovalExpiredError,
  ActionPayloadMismatchError,
  ActionProposalConflictError,
  ActionProposalNotFoundError,
} from "./domain/action-approval.js";
import { listCapabilities } from "./domain/capability-registry.js";
import {
  PersonalWorkflowConflictError,
  PersonalWorkflowNotFoundError,
} from "./domain/personal-workflow.js";
import {
  DurableMemoryConflictError,
  DurableMemoryNotFoundError,
  MemoryProposalConflictError,
  MemoryProposalNotFoundError,
  WorkTaskNotFoundError,
} from "./domain/work-context.js";
import { WatchedProjectNotFoundError } from "./domain/watched-project.js";
import {
  CareerEvidenceApprovalError,
  CareerEvidenceConflictError,
  CareerEvidenceNotFoundError,
} from "./domain/career-evidence.js";
import {
  loadMemoryReviewAssets,
  memoryReviewHeaders,
  type MemoryReviewAsset,
} from "./ui/memory-review-assets.js";
import { assertSameOrigin, RequestOriginError } from "./http/request-origin.js";
import {
  PublicContactIntentNotFoundError,
  PublicContactQueueUnavailableError,
} from "./public/public-contact-intent-queue.js";

const MAX_REQUEST_BYTES = 1_000_000;

const config = loadConfig();
const application = await createApplication(config);
const memoryReviewAssets = loadMemoryReviewAssets();

const server = createServer(async (request, response) => {
  try {
    await handleRequest(request, response);
  } catch (error) {
    handleError(error, response);
  }
});

server.listen(config.port, config.host, () => {
  process.stdout.write(
    `Jolene is listening at http://${config.host}:${config.port}\n`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      application.close();
      process.exit(0);
    });
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (request.method === "GET" && url.pathname === "/") {
    response.writeHead(302, {
      location: "/memory",
      "cache-control": "no-store",
    });
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/memory") {
    sendAsset(response, memoryReviewAssets.html);
    return;
  }

  if (request.method === "GET" && url.pathname === "/memory-review.css") {
    sendAsset(response, memoryReviewAssets.css);
    return;
  }

  if (request.method === "GET" && url.pathname === "/memory-review.js") {
    sendAsset(response, memoryReviewAssets.javascript);
    return;
  }

  if (request.method === "GET" && url.pathname === "/approvals") {
    sendAsset(response, memoryReviewAssets.actionHtml);
    return;
  }

  if (request.method === "GET" && url.pathname === "/workflows") {
    sendAsset(response, memoryReviewAssets.workflowHtml);
    return;
  }

  if (request.method === "GET" && url.pathname === "/projects") {
    sendAsset(response, memoryReviewAssets.projectHtml);
    return;
  }

  if (request.method === "GET" && url.pathname === "/career-evidence") {
    sendAsset(response, memoryReviewAssets.careerHtml);
    return;
  }

  if (request.method === "GET" && url.pathname === "/career-evidence.css") {
    sendAsset(response, memoryReviewAssets.careerCss);
    return;
  }

  if (request.method === "GET" && url.pathname === "/career-evidence.js") {
    sendAsset(response, memoryReviewAssets.careerJavascript);
    return;
  }

  if (request.method === "GET" && url.pathname === "/contacts") {
    sendAsset(response, memoryReviewAssets.contactHtml);
    return;
  }

  if (request.method === "GET" && url.pathname === "/contact-review.css") {
    sendAsset(response, memoryReviewAssets.contactCss);
    return;
  }

  if (request.method === "GET" && url.pathname === "/contact-review.js") {
    sendAsset(response, memoryReviewAssets.contactJavascript);
    return;
  }

  if (request.method === "GET" && url.pathname === "/project-watch.css") {
    sendAsset(response, memoryReviewAssets.projectCss);
    return;
  }

  if (request.method === "GET" && url.pathname === "/project-watch.js") {
    sendAsset(response, memoryReviewAssets.projectJavascript);
    return;
  }

  if (request.method === "GET" && url.pathname === "/workflow-review.css") {
    sendAsset(response, memoryReviewAssets.workflowCss);
    return;
  }

  if (request.method === "GET" && url.pathname === "/workflow-review.js") {
    sendAsset(response, memoryReviewAssets.workflowJavascript);
    return;
  }

  if (request.method === "GET" && url.pathname === "/action-review.css") {
    sendAsset(response, memoryReviewAssets.actionCss);
    return;
  }

  if (request.method === "GET" && url.pathname === "/action-review.js") {
    sendAsset(response, memoryReviewAssets.actionJavascript);
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, application.health());
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/capabilities") {
    sendJson(response, 200, listCapabilities());
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/watched-projects") {
    sendJson(response, 200, application.watchedProjects.list());
    return;
  }

  const watchedProjectMatch = url.pathname.match(
    /^\/v1\/watched-projects\/([^/]+)\/snapshot$/,
  );
  if (request.method === "GET" && watchedProjectMatch?.[1]) {
    sendJson(
      response,
      200,
      await application.watchedProjects.snapshot(watchedProjectMatch[1]),
    );
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/workflow-templates") {
    sendJson(response, 200, application.workflows.listTemplates());
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/workflows") {
    sendJson(response, 201, application.workflows.start(await readJson(request)));
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/workflows") {
    sendJson(
      response,
      200,
      application.workflows.list({
        actorId: url.searchParams.get("actorId"),
        workspaceId: url.searchParams.get("workspaceId"),
        taskId: url.searchParams.get("taskId") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
      }),
    );
    return;
  }

  const workflowMatch = url.pathname.match(/^\/v1\/workflows\/([^/]+)$/);
  if (request.method === "GET" && workflowMatch?.[1]) {
    sendJson(
      response,
      200,
      application.workflows.get({
        id: workflowMatch[1],
        actorId: url.searchParams.get("actorId"),
        workspaceId: url.searchParams.get("workspaceId"),
      }),
    );
    return;
  }

  const workflowStepMatch = url.pathname.match(
    /^\/v1\/workflows\/([^/]+)\/steps\/([^/]+)\/complete$/,
  );
  if (
    request.method === "POST" &&
    workflowStepMatch?.[1] &&
    workflowStepMatch[2]
  ) {
    sendJson(
      response,
      200,
      application.workflows.completeStep({
        ...asObject(await readJson(request)),
        id: workflowStepMatch[1],
        stepId: workflowStepMatch[2],
      }),
    );
    return;
  }

  const workflowReviewMatch = url.pathname.match(
    /^\/v1\/workflows\/([^/]+)\/review$/,
  );
  if (request.method === "POST" && workflowReviewMatch?.[1]) {
    sendJson(
      response,
      200,
      application.workflows.review(
        withIdentifier(await readJson(request), workflowReviewMatch[1]),
      ),
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/chat") {
    const body = chatRequestSchema.parse(await readJson(request));
    const result = await application.service.chat(body);
    sendJson(response, result.status === "processing" ? 202 : 200, result);
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/tasks") {
    sendJson(response, 201, application.work.createTask(await readJson(request)));
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/tasks") {
    sendJson(
      response,
      200,
      application.work.listTasks({
        actorId: url.searchParams.get("actorId"),
        workspaceId: url.searchParams.get("workspaceId"),
        status: url.searchParams.get("status") ?? undefined,
      }),
    );
    return;
  }

  const taskStatusMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/status$/);
  if (request.method === "PATCH" && taskStatusMatch?.[1]) {
    sendJson(
      response,
      200,
      application.work.updateTaskStatus(
        withIdentifier(await readJson(request), taskStatusMatch[1]),
      ),
    );
    return;
  }

  const taskEventsMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/events$/);
  if (request.method === "GET" && taskEventsMatch?.[1]) {
    sendJson(
      response,
      200,
      application.work.listTaskEvents({
        taskId: taskEventsMatch[1],
        actorId: url.searchParams.get("actorId"),
        workspaceId: url.searchParams.get("workspaceId"),
        limit: url.searchParams.get("limit") ?? undefined,
      }),
    );
    return;
  }

  if (request.method === "POST" && taskEventsMatch?.[1]) {
    assertSameOrigin(request.headers);
    sendJson(
      response,
      201,
      application.work.appendTaskEvent({
        ...asObject(await readJson(request)),
        taskId: taskEventsMatch[1],
      }),
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/memory-proposals") {
    sendJson(
      response,
      201,
      application.work.proposeMemory(await readJson(request)),
    );
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/memory-proposals") {
    sendJson(response, 200, application.work.listMemoryProposals({
      actorId: url.searchParams.get("actorId"),
      workspaceId: url.searchParams.get("workspaceId"),
      status: url.searchParams.get("status") ?? undefined,
    }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/memories") {
    sendJson(
      response,
      200,
      application.work.listMemories({
        actorId: url.searchParams.get("actorId"),
        workspaceId: url.searchParams.get("workspaceId"),
      }),
    );
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/knowledge-accesses") {
    sendJson(
      response,
      200,
      application.knowledgeAudit.listAccesses({
        actorId: url.searchParams.get("actorId"),
        workspaceId: url.searchParams.get("workspaceId"),
        eventId: url.searchParams.get("eventId") ?? undefined,
        limit: url.searchParams.get("limit") ?? undefined,
      }),
    );
    return;
  }

  if (
    request.method === "GET" &&
    url.pathname === "/v1/career-retrieval-accesses"
  ) {
    sendJson(
      response,
      200,
      application.careerRetrieval.listAccesses({
        actorId: url.searchParams.get("actorId"),
        workspaceId: url.searchParams.get("workspaceId"),
        limit: url.searchParams.get("limit") ?? undefined,
      }),
    );
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/career-evidence/scope") {
    sendJson(response, 200, application.careerEvidence.scope());
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/career-evidence/sources") {
    sendJson(response, 200, application.careerEvidence.listSources(scopeFrom(url)));
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/career-evidence/claims") {
    sendJson(response, 200, application.careerEvidence.listClaims(scopeFrom(url)));
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/career-evidence/validation") {
    sendJson(response, 200, application.careerEvidence.validate(scopeFrom(url)));
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/contact-intents") {
    sendJson(response, 200, await application.contactIntents.list({
      ...scopeFrom(url),
      status: url.searchParams.get("status") ?? undefined,
    }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/contact-intents/scope") {
    sendJson(response, 200, application.contactIntents.scope());
    return;
  }

  const contactReviewMatch = url.pathname.match(
    /^\/v1\/contact-intents\/([^/]+)\/review$/,
  );
  if (request.method === "POST" && contactReviewMatch?.[1]) {
    assertSameOrigin(request.headers);
    sendJson(response, 200, await application.contactIntents.markReviewed(
      withIdentifier(await readJson(request), contactReviewMatch[1]),
    ));
    return;
  }

  const contactDraftMatch = url.pathname.match(
    /^\/v1\/contact-intents\/([^/]+)\/reply-draft$/,
  );
  if (request.method === "POST" && contactDraftMatch?.[1]) {
    assertSameOrigin(request.headers);
    sendJson(response, 200, await application.contactIntents.saveReplyDraft(
      withIdentifier(await readJson(request), contactDraftMatch[1]),
    ));
    return;
  }

  const contactDeleteMatch = url.pathname.match(
    /^\/v1\/contact-intents\/([^/]+)\/delete$/,
  );
  if (request.method === "POST" && contactDeleteMatch?.[1]) {
    assertSameOrigin(request.headers);
    sendJson(response, 200, await application.contactIntents.delete(
      withIdentifier(await readJson(request), contactDeleteMatch[1]),
    ));
    return;
  }

  const sourceDecisionMatch = url.pathname.match(
    /^\/v1\/career-evidence\/sources\/([^/]+)\/decision$/,
  );
  if (request.method === "POST" && sourceDecisionMatch?.[1]) {
    assertSameOrigin(request.headers);
    sendJson(response, 200, application.careerEvidence.decideSource(
      withIdentifier(await readJson(request), decodeURIComponent(sourceDecisionMatch[1])),
    ));
    return;
  }

  const claimDecisionMatch = url.pathname.match(
    /^\/v1\/career-evidence\/claims\/([^/]+)\/decision$/,
  );
  if (request.method === "POST" && claimDecisionMatch?.[1]) {
    assertSameOrigin(request.headers);
    sendJson(response, 200, application.careerEvidence.decideClaim(
      withIdentifier(await readJson(request), claimDecisionMatch[1]),
    ));
    return;
  }

  const sourceRevokeMatch = url.pathname.match(
    /^\/v1\/career-evidence\/sources\/([^/]+)\/revoke$/,
  );
  if (request.method === "POST" && sourceRevokeMatch?.[1]) {
    assertSameOrigin(request.headers);
    sendJson(response, 200, application.careerEvidence.revokeSource(
      withIdentifier(await readJson(request), decodeURIComponent(sourceRevokeMatch[1])),
    ));
    return;
  }

  const claimRevokeMatch = url.pathname.match(
    /^\/v1\/career-evidence\/claims\/([^/]+)\/revoke$/,
  );
  if (request.method === "POST" && claimRevokeMatch?.[1]) {
    assertSameOrigin(request.headers);
    sendJson(response, 200, application.careerEvidence.revokeClaim(
      withIdentifier(await readJson(request), claimRevokeMatch[1]),
    ));
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/action-proposals") {
    sendJson(
      response,
      201,
      application.actionApprovals.createProposal(await readJson(request)),
    );
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/action-proposals") {
    sendJson(
      response,
      200,
      application.actionApprovals.listProposals({
        actorId: url.searchParams.get("actorId"),
        workspaceId: url.searchParams.get("workspaceId"),
        status: url.searchParams.get("status") ?? undefined,
        limit: url.searchParams.get("limit") ?? undefined,
      }),
    );
    return;
  }

  const actionDecisionMatch = url.pathname.match(
    /^\/v1\/action-proposals\/([^/]+)\/decision$/,
  );
  if (request.method === "POST" && actionDecisionMatch?.[1]) {
    sendJson(
      response,
      200,
      application.actionApprovals.decideProposal(
        withIdentifier(await readJson(request), actionDecisionMatch[1]),
      ),
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/context-preview") {
    sendJson(
      response,
      200,
      application.work.previewContext(await readJson(request)),
    );
    return;
  }

  const forgetMatch = url.pathname.match(/^\/v1\/memories\/([^/]+)\/forget$/);
  if (request.method === "POST" && forgetMatch?.[1]) {
    sendJson(
      response,
      200,
      application.work.forgetMemory(
        withIdentifier(await readJson(request), forgetMatch[1]),
      ),
    );
    return;
  }

  const decisionMatch = url.pathname.match(
    /^\/v1\/memory-proposals\/([^/]+)\/decision$/,
  );
  if (request.method === "POST" && decisionMatch?.[1]) {
    sendJson(
      response,
      200,
      application.work.decideMemory(
        withIdentifier(await readJson(request), decisionMatch[1]),
      ),
    );
    return;
  }

  sendJson(response, 404, { error: "not_found" });
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) {
      throw new RequestTooLargeError();
    }
    chunks.push(buffer);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(text || "{}");
}

function handleError(error: unknown, response: ServerResponse): void {
  if (error instanceof ZodError || error instanceof SyntaxError) {
    sendJson(response, 400, { error: "invalid_request" });
    return;
  }

  if (error instanceof RequestTooLargeError) {
    sendJson(response, 413, { error: "request_too_large" });
    return;
  }

  if (
    error instanceof WorkTaskNotFoundError ||
    error instanceof MemoryProposalNotFoundError ||
    error instanceof DurableMemoryNotFoundError ||
    error instanceof ActionProposalNotFoundError ||
    error instanceof PersonalWorkflowNotFoundError ||
    error instanceof WatchedProjectNotFoundError ||
    error instanceof CareerEvidenceNotFoundError ||
    error instanceof PublicContactIntentNotFoundError
  ) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }

  if (error instanceof MemoryProposalConflictError) {
    sendJson(response, 409, { error: "decision_conflict" });
    return;
  }

  if (error instanceof DurableMemoryConflictError) {
    sendJson(response, 409, { error: "memory_conflict" });
    return;
  }

  if (
    error instanceof ActionProposalConflictError ||
    error instanceof ActionPayloadMismatchError ||
    error instanceof PersonalWorkflowConflictError
  ) {
    sendJson(response, 409, { error: "action_conflict" });
    return;
  }

  if (error instanceof ActionApprovalExpiredError) {
    sendJson(response, 410, { error: "approval_expired" });
    return;
  }

  if (error instanceof ActionProposalPolicyError) {
    sendJson(response, 403, { error: "action_not_permitted" });
    return;
  }

  if (error instanceof CareerEvidenceScopeError) {
    sendJson(response, 403, { error: "career_scope_not_permitted" });
    return;
  }

  if (error instanceof ContactIntentReviewScopeError) {
    sendJson(response, 403, { error: "contact_scope_not_permitted" });
    return;
  }

  if (error instanceof PublicContactQueueUnavailableError) {
    sendJson(response, 503, { error: "contact_queue_unavailable" });
    return;
  }

  if (error instanceof RequestOriginError) {
    sendJson(response, 403, { error: "request_origin_not_permitted" });
    return;
  }

  if (error instanceof CareerEvidenceConflictError) {
    sendJson(response, 409, { error: "career_evidence_conflict" });
    return;
  }

  if (error instanceof CareerEvidenceApprovalError) {
    sendJson(response, 422, {
      error: "career_evidence_approval_blocked",
      issues: error.issues,
    });
    return;
  }

  process.stderr.write(
    `Jolene request failed: ${error instanceof Error ? error.name : "UnknownError"}\n`,
  );
  sendJson(response, 502, { error: "agent_unavailable" });
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function sendAsset(response: ServerResponse, asset: MemoryReviewAsset): void {
  response.writeHead(
    200,
    memoryReviewHeaders(asset.contentType, asset.body.byteLength),
  );
  response.end(asset.body);
}

class RequestTooLargeError extends Error {}

function withIdentifier(body: unknown, id: string): Record<string, unknown> {
  return { ...asObject(body), id };
}

function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SyntaxError("Expected a JSON object.");
  }
  return body as Record<string, unknown>;
}

function scopeFrom(url: URL): Record<string, string | null> {
  return {
    actorId: url.searchParams.get("actorId"),
    workspaceId: url.searchParams.get("workspaceId"),
  };
}
