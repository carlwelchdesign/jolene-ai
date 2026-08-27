const state = {
  scope: loadScope(),
  tasks: [],
  templates: [],
  details: [],
  briefing: null,
  filter: "open",
};

const ui = {
  notice: document.querySelector("#page-notice"),
  scopeButton: document.querySelector("#scope-button"),
  scopeLabel: document.querySelector("#scope-label"),
  scopeDialog: document.querySelector("#scope-dialog"),
  scopeForm: document.querySelector("#scope-form"),
  scopeActor: document.querySelector("#scope-actor"),
  scopeWorkspace: document.querySelector("#scope-workspace"),
  startButton: document.querySelector("#start-workflow-button"),
  startDialog: document.querySelector("#start-dialog"),
  startForm: document.querySelector("#start-form"),
  existingTaskFields: document.querySelector("#existing-task-fields"),
  newTaskFields: document.querySelector("#new-task-fields"),
  startTask: document.querySelector("#start-task"),
  newTaskTitle: document.querySelector("#new-task-title"),
  newTaskObjective: document.querySelector("#new-task-objective"),
  startKind: document.querySelector("#start-kind"),
  templatePreview: document.querySelector("#template-preview"),
  startError: document.querySelector("#start-error"),
  startSubmit: document.querySelector("#start-submit"),
  stepDialog: document.querySelector("#step-dialog"),
  stepForm: document.querySelector("#step-form"),
  stepWorkflowId: document.querySelector("#step-workflow-id"),
  stepId: document.querySelector("#step-id"),
  stepLabel: document.querySelector("#step-label"),
  stepRequirement: document.querySelector("#step-requirement"),
  stepSummary: document.querySelector("#step-summary"),
  stepError: document.querySelector("#step-error"),
  stepSubmit: document.querySelector("#step-submit"),
  reviewDialog: document.querySelector("#review-dialog"),
  reviewForm: document.querySelector("#review-form"),
  reviewWorkflowId: document.querySelector("#review-workflow-id"),
  reviewEvidence: document.querySelector("#review-evidence"),
  reviewDecision: document.querySelector("#review-decision"),
  revisionFields: document.querySelector("#revision-fields"),
  reviewReturnStep: document.querySelector("#review-return-step"),
  reviewFeedback: document.querySelector("#review-feedback"),
  reviewError: document.querySelector("#review-error"),
  reviewSubmit: document.querySelector("#review-submit"),
  cancelDialog: document.querySelector("#cancel-dialog"),
  cancelForm: document.querySelector("#cancel-form"),
  cancelWorkflowId: document.querySelector("#cancel-workflow-id"),
  cancelFeedback: document.querySelector("#cancel-feedback"),
  cancelError: document.querySelector("#cancel-error"),
  cancelSubmit: document.querySelector("#cancel-submit"),
  workflowList: document.querySelector("#workflow-list"),
  refreshButton: document.querySelector("#refresh-button"),
  countActive: document.querySelector("#count-active"),
  countReview: document.querySelector("#count-review"),
  countCompleted: document.querySelector("#count-completed"),
  toast: document.querySelector("#toast"),
  briefingStatus: document.querySelector("#briefing-status"),
  briefingToggle: document.querySelector("#briefing-toggle"),
  briefingFacts: document.querySelector("#briefing-facts"),
  briefingPreview: document.querySelector("#briefing-preview"),
  briefingHistory: document.querySelector("#briefing-history"),
};

initialize();

function initialize() {
  updateScopeLabels();
  wireDialogs();
  wireFilters();
  wireForms();
  ui.startButton.addEventListener("click", openStartDialog);
  ui.refreshButton.addEventListener("click", refreshAll);
  ui.startKind.addEventListener("change", renderTemplatePreview);
  ui.reviewDecision.addEventListener("change", updateReviewFields);
  ui.briefingToggle.addEventListener("click", toggleBriefing);
  document.querySelectorAll('input[name="task-mode"]').forEach((input) => {
    input.addEventListener("change", updateTaskMode);
  });
  refreshAll();
}

function wireDialogs() {
  ui.scopeButton.addEventListener("click", () => {
    ui.scopeActor.value = state.scope.actorId;
    ui.scopeWorkspace.value = state.scope.workspaceId;
    ui.scopeDialog.showModal();
  });
  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });
  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
}

function wireFilters() {
  document.querySelectorAll("[data-workflow-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.workflowFilter;
      document.querySelectorAll("[data-workflow-filter]").forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle("is-active", active);
        candidate.setAttribute("aria-pressed", String(active));
      });
      renderWorkflows();
    });
  });
}

function wireForms() {
  ui.scopeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const actorId = ui.scopeActor.value.trim();
    const workspaceId = ui.scopeWorkspace.value.trim();
    if (!actorId || !workspaceId) return;
    state.scope = { actorId, workspaceId };
    saveScope(state.scope);
    updateScopeLabels();
    ui.scopeDialog.close();
    refreshAll();
  });
  ui.startForm.addEventListener("submit", submitStart);
  ui.stepForm.addEventListener("submit", submitStep);
  ui.reviewForm.addEventListener("submit", submitReview);
  ui.cancelForm.addEventListener("submit", submitCancel);
}

async function refreshAll() {
  clearNotice();
  setLoading(ui.workflowList, "Loading workflows…");
  const results = await Promise.allSettled([
    loadTemplates(),
    loadTasks(),
    loadWorkflows(),
    loadBriefing(),
  ]);
  if (results.some((result) => result.status === "rejected")) {
    showNotice("Some workflow data could not be refreshed. Retry when Jolene’s local service is available.", true);
  }
  if (results[2]?.status === "fulfilled") {
    renderSummary();
    renderWorkflows();
  }
}

async function loadBriefing() {
  state.briefing = await api("/v1/private-briefing");
  renderBriefing();
}

function renderBriefing() {
  const briefing = state.briefing;
  if (!briefing) return;
  ui.briefingStatus.textContent = humanize(briefing.status);
  ui.briefingStatus.dataset.status = briefing.status;
  ui.briefingToggle.textContent = briefing.status === "active" ? "Pause" : "Resume";
  ui.briefingToggle.disabled = briefing.status === "stopped" ||
    (!briefing.policy.enabled && briefing.status !== "active");
  const schedule = briefing.policy.frequency === "weekly"
    ? `Weekly · ${weekdayName(briefing.policy.dayOfWeek)} at ${clockTime(briefing.policy)}`
    : `Daily · ${clockTime(briefing.policy)}`;
  ui.briefingFacts.replaceChildren(
    fact("Schedule", `${schedule} · ${briefing.policy.timeZone}`),
    fact("Next due", formatTimestamp(briefing.nextRunAt)),
    fact("Last generated", formatTimestamp(briefing.lastRunAt)),
    fact("Bounded delivery", `${briefing.deliveryCount} of ${briefing.policy.stopAfterDeliveries} total · ${briefing.deliveriesToday} of ${briefing.policy.maxDeliveriesPerDay} today`),
  );
  ui.briefingPreview.textContent = briefing.previewMessage;
  ui.briefingHistory.replaceChildren();
  if (briefing.history.length === 0) {
    ui.briefingHistory.append(el("li", "briefing-history-empty", "No delivery attempts yet."));
  } else {
    briefing.history.forEach((run) => {
      const item = el("li");
      item.append(
        el("strong", "", humanize(run.status)),
        el("span", "", `${formatTimestamp(run.scheduledFor)} · ${run.attempts} ${run.attempts === 1 ? "attempt" : "attempts"}`),
      );
      ui.briefingHistory.append(item);
    });
  }
}

async function toggleBriefing() {
  if (!state.briefing) return;
  ui.briefingToggle.disabled = true;
  const action = state.briefing.status === "active" ? "pause" : "resume";
  try {
    state.briefing = await api(`/v1/private-briefing/${action}`, { method: "POST" });
    renderBriefing();
    showToast(action === "pause" ? "Private briefings paused." : "Private briefings resumed at the next scheduled time.");
  } catch (error) {
    showNotice(friendlyError(error), true);
  } finally {
    renderBriefing();
  }
}

async function loadTemplates() {
  state.templates = await api("/v1/workflow-templates");
  populateTemplateSelect();
}

async function loadTasks() {
  state.tasks = await api("/v1/tasks" + scopeQuery());
  populateTaskSelect();
}

async function loadWorkflows() {
  try {
    const workflows = await api("/v1/workflows" + scopeQuery());
    const results = await Promise.allSettled(workflows.map((workflow) => api(
      "/v1/workflows/" + encodeURIComponent(workflow.id) + scopeQuery(),
    )));
    state.details = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
    renderSummary();
    renderWorkflows();
    if (results.some((result) => result.status === "rejected")) {
      showNotice("Some workflow histories could not be loaded. The visible cards are current; refresh to retry the missing records.", true);
    }
  } catch (error) {
    renderError(ui.workflowList, friendlyError(error));
    throw error;
  }
}

function renderSummary() {
  ui.countActive.textContent = String(countStatus("active"));
  ui.countReview.textContent = String(countStatus("awaiting_review"));
  ui.countCompleted.textContent = String(countStatus("completed"));
}

function countStatus(status) {
  return state.details.filter((detail) => detail.workflow.status === status).length;
}

function renderWorkflows() {
  ui.workflowList.replaceChildren();
  ui.workflowList.setAttribute("aria-busy", "false");
  const details = state.details.filter(matchesFilter);
  if (details.length === 0) {
    ui.workflowList.append(emptyState(
      state.filter === "open" ? "No open work" : "No workflows in this state",
      state.filter === "open"
        ? "Start a bounded workflow when you want Jolene’s progress and evidence to remain visible."
        : "Choose another filter to review workflow history.",
    ));
    return;
  }
  details.forEach((detail) => ui.workflowList.append(workflowCard(detail)));
}

function matchesFilter(detail) {
  const status = detail.workflow.status;
  if (state.filter === "all") return true;
  if (state.filter === "open") return status === "active" || status === "awaiting_review";
  return status === state.filter;
}

function workflowCard(detail) {
  const { workflow, template, events } = detail;
  const task = state.tasks.find((candidate) => candidate.id === workflow.taskId);
  const card = el("article", "workflow-card");
  if (workflow.status === "awaiting_review") card.classList.add("is-review");
  if (workflow.status === "completed") card.classList.add("is-complete");

  const badges = el("div", "badge-row");
  badges.append(
    badge(template.label),
    badge(humanize(workflow.status), "badge-" + workflow.status),
  );
  card.append(badges);
  card.append(el("h3", "workflow-title", task?.title || "Task " + shorten(workflow.taskId)));
  card.append(el("p", "workflow-objective", task?.objective || template.description));

  const completedStepIds = new Set(
    events.filter((event) => event.type === "step_completed" && event.stepId)
      .map((event) => event.stepId),
  );
  const currentIndex = template.steps.findIndex(
    (step) => step.id === workflow.currentStepId,
  );
  const completedCount = workflow.status === "active" && currentIndex >= 0
    ? currentIndex
    : workflow.status === "awaiting_review" || workflow.status === "completed"
      ? template.steps.length
      : completedStepIds.size;
  const percent = Math.round((completedCount / template.steps.length) * 100);
  const progress = el("div", "workflow-progress");
  const progressHeading = el("div", "progress-heading");
  progressHeading.append(
    el("span", "", `${completedCount} of ${template.steps.length} required steps evidenced`),
    el("span", "", `${percent}%`),
  );
  const track = el("div", "progress-track");
  const fill = el("span");
  fill.style.width = percent + "%";
  track.append(fill);
  progress.append(progressHeading, track);
  card.append(progress);

  const currentStep = template.steps.find((step) => step.id === workflow.currentStepId);
  if (workflow.status === "active" && currentStep) {
    const current = el("div", "current-step");
    current.append(
      el("span", "", "Current step"),
      el("strong", "", currentStep.label),
      el("p", "", currentStep.completionEvidence),
    );
    card.append(current);
  } else if (workflow.status === "awaiting_review") {
    card.append(el("div", "workflow-state needs-review", "All required steps are evidenced. Your review is required before completion."));
  } else if (workflow.status === "completed") {
    card.append(el("div", "workflow-state", "Human-reviewed and marked complete. No external action was authorized."));
  } else {
    card.append(el("div", "workflow-state is-cancelled", "Cancelled. The evidence history remains read-only."));
  }

  card.append(eventHistory(detail));
  if (workflow.status === "active" || workflow.status === "awaiting_review") {
    const actions = el("div", "card-actions");
    if (workflow.status === "active" && currentStep) {
      const complete = button("Record step evidence", "button button-primary button-small");
      complete.addEventListener("click", () => openStepDialog(detail, currentStep));
      actions.append(complete);
    }
    if (workflow.status === "awaiting_review") {
      const review = button("Review work", "button button-primary button-small");
      review.addEventListener("click", () => openReviewDialog(detail));
      actions.append(review);
    }
    const cancel = button("Cancel workflow", "button button-secondary button-small");
    cancel.addEventListener("click", () => openCancelDialog(detail));
    actions.append(cancel);
    card.append(actions);
  }
  return card;
}

function eventHistory(detail) {
  const disclosure = el("details", "event-details");
  const summary = el("summary", "", `Evidence history · ${detail.events.length} events`);
  const list = el("ol", "event-list");
  detail.events.forEach((event) => {
    const item = el("li");
    const step = detail.template.steps.find((candidate) => candidate.id === event.stepId);
    item.append(
      el("strong", "", step ? `${humanize(event.type)} · ${step.label}` : humanize(event.type)),
      el("span", "", event.summary || "No additional note."),
    );
    list.append(item);
  });
  disclosure.append(summary, list);
  return disclosure;
}

function openStartDialog() {
  ui.startForm.reset();
  clearInlineError(ui.startError);
  populateTaskSelect();
  populateTemplateSelect();
  if (state.tasks.length === 0) {
    document.querySelector('input[name="task-mode"][value="new"]').checked = true;
  }
  updateTaskMode();
  renderTemplatePreview();
  ui.startDialog.showModal();
  (isNewTaskMode() ? ui.newTaskTitle : ui.startTask).focus();
}

async function submitStart(event) {
  event.preventDefault();
  clearInlineError(ui.startError);
  ui.startSubmit.disabled = true;
  let taskId = ui.startTask.value;
  let createdTask = null;
  try {
    if (isNewTaskMode()) {
      const title = ui.newTaskTitle.value.trim();
      const objective = ui.newTaskObjective.value.trim();
      if (!title || !objective) {
        showInlineError(ui.startError, "A new task needs both a title and an objective.");
        return;
      }
      createdTask = await api("/v1/tasks", {
        method: "POST",
        body: { ...state.scope, title, objective },
      });
      taskId = createdTask.id;
    }
    if (!taskId) {
      showInlineError(ui.startError, "Choose an existing task or create a new one.");
      return;
    }
    await api("/v1/workflows", {
      method: "POST",
      body: { ...state.scope, taskId, kind: ui.startKind.value },
    });
    ui.startDialog.close();
    state.filter = "open";
    activateWorkflowFilter("open");
    showToast("Workflow started at its first required step.");
    await Promise.all([loadTasks(), loadWorkflows()]);
  } catch (error) {
    if (createdTask) {
      await loadTasks().catch(() => {});
      showInlineError(ui.startError, `The task “${createdTask.title}” was created, but the workflow did not start. Select that task and retry. ${friendlyError(error)}`);
    } else {
      showInlineError(ui.startError, friendlyError(error));
    }
  } finally {
    ui.startSubmit.disabled = false;
  }
}

function openStepDialog(detail, step) {
  ui.stepForm.reset();
  ui.stepWorkflowId.value = detail.workflow.id;
  ui.stepId.value = step.id;
  ui.stepLabel.textContent = step.label;
  ui.stepRequirement.textContent = step.completionEvidence;
  clearInlineError(ui.stepError);
  ui.stepDialog.showModal();
  ui.stepSummary.focus();
}

async function submitStep(event) {
  event.preventDefault();
  ui.stepSubmit.disabled = true;
  clearInlineError(ui.stepError);
  try {
    await api(
      "/v1/workflows/" + encodeURIComponent(ui.stepWorkflowId.value) +
      "/steps/" + encodeURIComponent(ui.stepId.value) + "/complete",
      { method: "POST", body: { ...state.scope, summary: ui.stepSummary.value.trim() } },
    );
    ui.stepDialog.close();
    showToast("Step evidence recorded.");
    await loadWorkflows();
  } catch (error) {
    showInlineError(ui.stepError, friendlyError(error));
  } finally {
    ui.stepSubmit.disabled = false;
  }
}

function openReviewDialog(detail) {
  ui.reviewForm.reset();
  ui.reviewWorkflowId.value = detail.workflow.id;
  ui.reviewEvidence.replaceChildren();
  detail.events.filter((event) => event.type === "step_completed").forEach((event) => {
    const step = detail.template.steps.find((candidate) => candidate.id === event.stepId);
    const row = el("div", "evidence-row");
    row.append(
      el("strong", "", step?.label || humanize(event.stepId)),
      el("p", "", event.summary),
    );
    ui.reviewEvidence.append(row);
  });
  ui.reviewReturnStep.replaceChildren();
  detail.template.steps.forEach((step) => ui.reviewReturnStep.append(option(step.id, step.label)));
  clearInlineError(ui.reviewError);
  updateReviewFields();
  ui.reviewDialog.showModal();
  ui.reviewDecision.focus();
}

function updateReviewFields() {
  const revising = ui.reviewDecision.value === "changes_requested";
  ui.revisionFields.hidden = !revising;
  ui.reviewReturnStep.required = revising;
  ui.reviewFeedback.required = revising;
}

async function submitReview(event) {
  event.preventDefault();
  const revising = ui.reviewDecision.value === "changes_requested";
  ui.reviewSubmit.disabled = true;
  clearInlineError(ui.reviewError);
  try {
    await api(
      "/v1/workflows/" + encodeURIComponent(ui.reviewWorkflowId.value) + "/review",
      {
        method: "POST",
        body: {
          ...state.scope,
          decision: ui.reviewDecision.value,
          feedback: ui.reviewFeedback.value.trim(),
          returnToStepId: revising ? ui.reviewReturnStep.value : null,
        },
      },
    );
    ui.reviewDialog.close();
    showToast(revising ? "Changes requested. The workflow is active again." : "Workflow marked complete. No external action was authorized.");
    await loadWorkflows();
  } catch (error) {
    showInlineError(ui.reviewError, friendlyError(error));
  } finally {
    ui.reviewSubmit.disabled = false;
  }
}

function openCancelDialog(detail) {
  ui.cancelForm.reset();
  ui.cancelWorkflowId.value = detail.workflow.id;
  clearInlineError(ui.cancelError);
  ui.cancelDialog.showModal();
  ui.cancelFeedback.focus();
}

async function submitCancel(event) {
  event.preventDefault();
  ui.cancelSubmit.disabled = true;
  clearInlineError(ui.cancelError);
  try {
    await api(
      "/v1/workflows/" + encodeURIComponent(ui.cancelWorkflowId.value) + "/review",
      {
        method: "POST",
        body: {
          ...state.scope,
          decision: "cancelled",
          feedback: ui.cancelFeedback.value.trim(),
          returnToStepId: null,
        },
      },
    );
    ui.cancelDialog.close();
    showToast("Workflow cancelled. Its evidence history was retained.");
    await loadWorkflows();
  } catch (error) {
    showInlineError(ui.cancelError, friendlyError(error));
  } finally {
    ui.cancelSubmit.disabled = false;
  }
}

function updateTaskMode() {
  const creating = isNewTaskMode();
  ui.existingTaskFields.hidden = creating;
  ui.newTaskFields.hidden = !creating;
  ui.startTask.required = !creating;
  ui.newTaskTitle.required = creating;
  ui.newTaskObjective.required = creating;
}

function isNewTaskMode() {
  return document.querySelector('input[name="task-mode"]:checked')?.value === "new";
}

function populateTaskSelect() {
  const current = ui.startTask.value;
  ui.startTask.replaceChildren(option("", state.tasks.length ? "Choose a task" : "No tasks available"));
  state.tasks.forEach((task) => ui.startTask.append(option(task.id, `${task.title} · ${humanize(task.status)}`)));
  if ([...ui.startTask.options].some((candidate) => candidate.value === current)) {
    ui.startTask.value = current;
  }
}

function populateTemplateSelect() {
  const current = ui.startKind.value;
  ui.startKind.replaceChildren();
  state.templates.forEach((template) => ui.startKind.append(option(template.kind, template.label)));
  if ([...ui.startKind.options].some((candidate) => candidate.value === current)) {
    ui.startKind.value = current;
  }
  renderTemplatePreview();
}

function activateWorkflowFilter(filter) {
  document.querySelectorAll("[data-workflow-filter]").forEach((button) => {
    const active = button.dataset.workflowFilter === filter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function renderTemplatePreview() {
  const template = state.templates.find((candidate) => candidate.kind === ui.startKind.value);
  ui.templatePreview.replaceChildren();
  if (!template) {
    ui.templatePreview.append(el("p", "", "Workflow templates are still loading."));
    return;
  }
  const steps = el("ol", "template-steps");
  template.steps.forEach((step, index) => steps.append(el("li", "", `${index + 1}. ${step.label}`)));
  ui.templatePreview.append(
    el("strong", "", template.label),
    el("p", "", template.description),
    steps,
  );
}

function loadScope() {
  try {
    const saved = JSON.parse(window.localStorage.getItem("jolene-memory-scope") || "null");
    if (saved && saved.actorId && saved.workspaceId) return saved;
  } catch {}
  return { actorId: "carl", workspaceId: "personal" };
}

function saveScope(scope) {
  try { window.localStorage.setItem("jolene-memory-scope", JSON.stringify(scope)); } catch {}
}

function updateScopeLabels() {
  ui.scopeLabel.textContent = state.scope.actorId + " · " + state.scope.workspaceId;
}

function scopeQuery() {
  return "?" + new URLSearchParams(state.scope).toString();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let body;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) {
    const error = new Error(body && body.error ? body.error : "request_failed");
    error.status = response.status;
    throw error;
  }
  return body;
}

function friendlyError(error) {
  if (error && error.message === "action_conflict") return "This workflow changed before the update completed. Refresh and review its current step.";
  if (error && error.message === "invalid_request") return "Some workflow information is missing or invalid. Review the required fields and try again.";
  if (error && error.status === 404) return "That task or workflow is no longer available in this work scope.";
  return "Jolene’s local workflow service is unavailable. Check that the local service is running, then retry.";
}

function humanize(value) {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fact(label, value) {
  const wrapper = el("div");
  wrapper.append(el("dt", "", label), el("dd", "", value));
  return wrapper;
}

function formatTimestamp(value) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Unavailable" : date.toLocaleString();
}

function clockTime(policy) {
  const date = new Date(Date.UTC(2000, 0, 1, policy.localHour, policy.localMinute));
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

function weekdayName(value) {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][value] || "Scheduled day";
}

function shorten(value) {
  return value && value.length > 16 ? value.slice(0, 12) + "…" : value || "unknown";
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, className) {
  const node = el("button", className, label);
  node.type = "button";
  return node;
}

function option(value, label) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function badge(label, extraClass = "") {
  return el("span", "badge " + extraClass, label);
}

function emptyState(title, message) {
  const node = el("div", "empty-state");
  node.append(el("strong", "", title), el("p", "", message));
  return node;
}

function setLoading(container, message) {
  container.replaceChildren(el("div", "loading-state", message));
  container.setAttribute("aria-busy", "true");
}

function renderError(container, message) {
  const node = el("div", "error-state");
  node.append(el("strong", "", "Couldn’t load workflows"), el("p", "", message));
  container.replaceChildren(node);
  container.setAttribute("aria-busy", "false");
}

function showNotice(message, isError) {
  ui.notice.textContent = message;
  ui.notice.classList.toggle("is-error", Boolean(isError));
  ui.notice.hidden = false;
}

function clearNotice() {
  ui.notice.hidden = true;
  ui.notice.textContent = "";
  ui.notice.classList.remove("is-error");
}

function showInlineError(node, message) {
  node.textContent = message;
  node.hidden = false;
}

function clearInlineError(node) {
  node.hidden = true;
  node.textContent = "";
}

let toastTimer;
function showToast(message) {
  window.clearTimeout(toastTimer);
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  toastTimer = window.setTimeout(() => { ui.toast.hidden = true; }, 3600);
}
