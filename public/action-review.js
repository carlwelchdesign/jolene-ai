const state = {
  scope: loadScope(),
  tasks: [],
  proposals: [],
  filter: "pending",
};

const ui = {
  notice: document.querySelector("#page-notice"),
  scopeButton: document.querySelector("#scope-button"),
  scopeLabel: document.querySelector("#scope-label"),
  scopeDialog: document.querySelector("#scope-dialog"),
  scopeForm: document.querySelector("#scope-form"),
  scopeActor: document.querySelector("#scope-actor"),
  scopeWorkspace: document.querySelector("#scope-workspace"),
  stageButton: document.querySelector("#stage-action-button"),
  stageDialog: document.querySelector("#stage-dialog"),
  stageForm: document.querySelector("#stage-form"),
  stageDestinationKind: document.querySelector("#stage-destination-kind"),
  stageDestinationId: document.querySelector("#stage-destination-id"),
  stageDataClass: document.querySelector("#stage-data-class"),
  stageTask: document.querySelector("#stage-task"),
  stageContent: document.querySelector("#stage-content"),
  stagePurpose: document.querySelector("#stage-purpose"),
  stageExpiry: document.querySelector("#stage-expiry"),
  stageError: document.querySelector("#stage-error"),
  stageSubmit: document.querySelector("#stage-submit"),
  approveDialog: document.querySelector("#approve-dialog"),
  approveForm: document.querySelector("#approve-form"),
  approveId: document.querySelector("#approve-id"),
  approveDetails: document.querySelector("#approve-details"),
  approveError: document.querySelector("#approve-error"),
  approveSubmit: document.querySelector("#approve-submit"),
  actionList: document.querySelector("#action-list"),
  refreshButton: document.querySelector("#refresh-button"),
  countPending: document.querySelector("#count-pending"),
  countApproved: document.querySelector("#count-approved"),
  countClosed: document.querySelector("#count-closed"),
  toast: document.querySelector("#toast"),
};

initialize();

function initialize() {
  updateScopeLabels();
  wireDialogs();
  wireFilters();
  wireForms();
  ui.stageButton.addEventListener("click", openStageDialog);
  ui.refreshButton.addEventListener("click", refreshAll);
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
  document.querySelectorAll("[data-action-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.actionFilter;
      document.querySelectorAll("[data-action-filter]").forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle("is-active", active);
        candidate.setAttribute("aria-pressed", String(active));
      });
      renderProposals();
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
  ui.stageForm.addEventListener("submit", submitStage);
  ui.stageDataClass.addEventListener("change", validateTaskBinding);
  ui.stageTask.addEventListener("change", validateTaskBinding);
  ui.approveForm.addEventListener("submit", submitApproval);
}

async function refreshAll() {
  clearNotice();
  setLoading(ui.actionList, "Loading action proposals…");
  const results = await Promise.allSettled([loadTasks(), loadProposals()]);
  if (results.some((result) => result.status === "rejected")) {
    showNotice("Some approval data could not be refreshed. Retry when Jolene’s local service is available.", true);
  }
}

async function loadTasks() {
  try {
    state.tasks = await api("/v1/tasks" + scopeQuery());
    populateTaskSelect();
  } catch (error) {
    state.tasks = [];
    populateTaskSelect();
    throw error;
  }
}

async function loadProposals() {
  try {
    state.proposals = await api("/v1/action-proposals" + scopeQuery(undefined, 200));
    renderSummary();
    renderProposals();
  } catch (error) {
    renderError(ui.actionList, friendlyError(error));
    throw error;
  }
}

function renderSummary() {
  ui.countPending.textContent = String(countStatus("pending"));
  ui.countApproved.textContent = String(countStatus("approved"));
  ui.countClosed.textContent = String(state.proposals.filter((proposal) => ["rejected", "expired", "consumed"].includes(proposal.status)).length);
}

function countStatus(status) {
  return state.proposals.filter((proposal) => proposal.status === status).length;
}

function renderProposals() {
  ui.actionList.replaceChildren();
  ui.actionList.setAttribute("aria-busy", "false");
  const proposals = state.filter === "all"
    ? state.proposals
    : state.proposals.filter((proposal) => proposal.status === state.filter);
  if (proposals.length === 0) {
    ui.actionList.append(emptyState(
      state.filter === "pending" ? "Nothing waiting" : "No proposals in this state",
      state.filter === "pending"
        ? "Jolene has no external actions waiting for your approval."
        : "Choose another filter to review the approval history.",
    ));
    return;
  }
  proposals.forEach((proposal) => ui.actionList.append(actionCard(proposal)));
}

function actionCard(proposal) {
  const card = el("article", "action-card");
  if (["private", "restricted", "sensitive"].includes(proposal.dataClass)) {
    card.classList.add("is-sensitive");
  }
  const top = el("div", "card-topline");
  const badges = el("div", "badge-row");
  badges.append(
    badge(humanize(proposal.destinationKind)),
    badge(humanize(proposal.dataClass), proposal.dataClass === "general" ? "" : "badge-sensitive"),
    badge(humanize(proposal.status), "badge-" + proposal.status),
  );
  top.append(badges);
  card.append(top);
  card.append(el("p", "recipient-line", "Exact recipient"));
  card.append(el("p", "recipient-value", proposal.destinationId));
  card.append(el("blockquote", "message-preview", proposal.content));
  card.append(el("p", "purpose-copy", "Purpose: " + proposal.purpose));
  const meta = el("div", "meta-list");
  meta.append(
    el("span", "", "Risk: " + humanize(proposal.effectiveRisk)),
    el("span", "", "Task: " + taskName(proposal.taskId)),
    el("span", "", "Permission expires: " + formatDate(proposal.expiresAt)),
    el("span", "", "Exact fingerprint: " + shorten(proposal.payloadFingerprint)),
  );
  card.append(meta);

  if (proposal.status === "pending") {
    const actions = el("div", "card-actions");
    const approve = button("Review and approve", "button button-primary button-small");
    const reject = button("Reject", "button button-secondary button-small");
    approve.addEventListener("click", () => openApproval(proposal));
    reject.addEventListener("click", () => decideProposal(proposal, "rejected", [approve, reject]));
    actions.append(approve, reject);
    card.append(actions);
  } else if (proposal.status === "approved") {
    card.append(el("div", "approval-state", "Approved · nothing has been sent"));
  } else if (proposal.status === "consumed") {
    card.append(el("div", "approval-state", "Permission claimed by an adapter · delivery is not proven here"));
  } else {
    card.append(el("div", "approval-state is-closed", humanize(proposal.status) + " · this proposal cannot authorize delivery"));
  }
  return card;
}

function openStageDialog() {
  ui.stageForm.reset();
  ui.stageExpiry.value = toLocalDateTime(new Date(Date.now() + 60 * 60 * 1000));
  ui.stageExpiry.min = toLocalDateTime(new Date(Date.now() + 60 * 1000));
  ui.stageExpiry.max = toLocalDateTime(new Date(Date.now() + 24 * 60 * 60 * 1000));
  clearInlineError(ui.stageError);
  ui.stageDialog.showModal();
  ui.stageDestinationId.focus();
}

async function submitStage(event) {
  event.preventDefault();
  if (!validateTaskBinding()) return;
  clearInlineError(ui.stageError);
  ui.stageSubmit.disabled = true;
  try {
    await api("/v1/action-proposals", {
      method: "POST",
      body: {
        ...state.scope,
        capabilityId: "external_message.send",
        taskId: ui.stageTask.value || null,
        originChannelKind: "private_chat",
        destinationKind: ui.stageDestinationKind.value,
        destinationId: ui.stageDestinationId.value.trim(),
        content: ui.stageContent.value.trim(),
        dataClass: ui.stageDataClass.value,
        purpose: ui.stagePurpose.value.trim(),
        expiresAt: new Date(ui.stageExpiry.value).toISOString(),
      },
    });
    ui.stageDialog.close();
    state.filter = "pending";
    activateFilter("pending");
    showToast("Message added to approval review. Nothing was sent.");
    await loadProposals();
  } catch (error) {
    showInlineError(ui.stageError, friendlyError(error));
  } finally {
    ui.stageSubmit.disabled = false;
  }
}

function validateTaskBinding() {
  const requiresTask = ["restricted", "sensitive"].includes(ui.stageDataClass.value);
  const valid = !requiresTask || Boolean(ui.stageTask.value);
  if (!valid) {
    showInlineError(ui.stageError, "Restricted and sensitive messages must be tied to a task.");
  } else {
    clearInlineError(ui.stageError);
  }
  return valid;
}

function openApproval(proposal) {
  ui.approveId.value = proposal.id;
  ui.approveDetails.replaceChildren();
  addReviewRow("Recipient", humanize(proposal.destinationKind) + " · " + proposal.destinationId);
  addReviewRow("Complete message", proposal.content);
  addReviewRow("Classification", humanize(proposal.dataClass) + " · " + humanize(proposal.effectiveRisk));
  addReviewRow("Purpose", proposal.purpose);
  addReviewRow("Task", taskName(proposal.taskId));
  addReviewRow("Expires", formatDate(proposal.expiresAt));
  clearInlineError(ui.approveError);
  ui.approveDialog.showModal();
  ui.approveSubmit.focus();
}

function addReviewRow(label, value) {
  ui.approveDetails.append(el("dt", "", label), el("dd", "", value));
}

async function submitApproval(event) {
  event.preventDefault();
  ui.approveSubmit.disabled = true;
  clearInlineError(ui.approveError);
  try {
    await api("/v1/action-proposals/" + encodeURIComponent(ui.approveId.value) + "/decision", {
      method: "POST",
      body: { ...state.scope, decision: "approved" },
    });
    ui.approveDialog.close();
    showToast("Exact action approved. Nothing was sent.");
    await loadProposals();
  } catch (error) {
    showInlineError(ui.approveError, friendlyError(error));
  } finally {
    ui.approveSubmit.disabled = false;
  }
}

async function decideProposal(proposal, decision, controls) {
  setDisabled(controls, true);
  try {
    await api("/v1/action-proposals/" + encodeURIComponent(proposal.id) + "/decision", {
      method: "POST",
      body: { ...state.scope, decision },
    });
    showToast("Action proposal rejected. Nothing was sent.");
    await loadProposals();
  } catch (error) {
    showNotice(friendlyError(error), true);
    setDisabled(controls, false);
  }
}

function populateTaskSelect() {
  const current = ui.stageTask.value;
  ui.stageTask.replaceChildren(option("", "No selected task"));
  state.tasks.forEach((task) => ui.stageTask.append(option(task.id, task.title + " · " + humanize(task.status))));
  if ([...ui.stageTask.options].some((candidate) => candidate.value === current)) {
    ui.stageTask.value = current;
  }
}

function activateFilter(filter) {
  document.querySelectorAll("[data-action-filter]").forEach((button) => {
    const active = button.dataset.actionFilter === filter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
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

function scopeQuery(status, limit) {
  const params = new URLSearchParams(state.scope);
  if (status) params.set("status", status);
  if (limit) params.set("limit", String(limit));
  return "?" + params.toString();
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
  if (error && error.message === "approval_expired") return "This permission window expired. Stage a fresh proposal for review.";
  if (error && error.message === "action_conflict") return "This proposal changed before the decision completed. Refresh and review its current state.";
  if (error && error.message === "action_not_permitted") return "Jolene’s safety policy does not permit this proposal.";
  if (error && error.message === "invalid_request") return "Some proposal information is missing or invalid. Review each field and the expiration time.";
  if (error && error.status === 404) return "That proposal is no longer available in this approval scope.";
  return "Jolene’s local approval service is unavailable. Check that the local service is running, then retry.";
}

function taskName(taskId) {
  if (!taskId) return "No selected task";
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  return task ? task.title : "Task " + shorten(taskId);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Unknown date" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function toLocalDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  const local = new Date(date.valueOf() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function humanize(value) {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
  node.append(el("strong", "", "Couldn’t load approvals"), el("p", "", message));
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
  toastTimer = window.setTimeout(() => { ui.toast.hidden = true; }, 3400);
}

function setDisabled(controls, disabled) {
  controls.forEach((control) => { control.disabled = disabled; });
}
