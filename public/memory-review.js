const state = {
  scope: loadScope(),
  tasks: [],
  proposals: [],
  memories: [],
  memoryFilter: "active",
};

const ui = {
  notice: document.querySelector("#page-notice"),
  scopeButton: document.querySelector("#scope-button"),
  scopeLabel: document.querySelector("#scope-label"),
  scopeDialog: document.querySelector("#scope-dialog"),
  scopeForm: document.querySelector("#scope-form"),
  scopeActor: document.querySelector("#scope-actor"),
  scopeWorkspace: document.querySelector("#scope-workspace"),
  proposalList: document.querySelector("#proposal-list"),
  proposalCount: document.querySelector("#review-count"),
  memoryList: document.querySelector("#memory-list"),
  proposalDialog: document.querySelector("#proposal-dialog"),
  proposalForm: document.querySelector("#proposal-form"),
  proposalTitle: document.querySelector("#proposal-dialog-title"),
  proposalEyebrow: document.querySelector("#proposal-dialog-eyebrow"),
  proposalCopy: document.querySelector("#proposal-dialog-copy"),
  proposalContent: document.querySelector("#proposal-content"),
  proposalKind: document.querySelector("#proposal-kind"),
  proposalTask: document.querySelector("#proposal-task"),
  proposalSensitivity: document.querySelector("#proposal-sensitivity"),
  proposalExpiry: document.querySelector("#proposal-expiry"),
  proposalSource: document.querySelector("#proposal-source"),
  proposalReplaces: document.querySelector("#proposal-replaces"),
  proposalError: document.querySelector("#proposal-error"),
  proposalSubmit: document.querySelector("#proposal-submit"),
  forgetDialog: document.querySelector("#forget-dialog"),
  forgetForm: document.querySelector("#forget-form"),
  forgetId: document.querySelector("#forget-id"),
  forgetContent: document.querySelector("#forget-content"),
  forgetError: document.querySelector("#forget-error"),
  forgetSubmit: document.querySelector("#forget-submit"),
  previewForm: document.querySelector("#preview-form"),
  previewQuery: document.querySelector("#preview-query"),
  previewTask: document.querySelector("#preview-task"),
  previewSensitive: document.querySelector("#preview-sensitive"),
  previewResults: document.querySelector("#preview-results"),
  toast: document.querySelector("#toast"),
};

initialize();

function initialize() {
  updateScopeLabels();
  wireTabs();
  wireDialogs();
  wireFilters();
  wireForms();
  document.querySelector("#new-memory-button").addEventListener("click", openNewProposal);
  document.querySelectorAll("[data-refresh]").forEach((button) => {
    button.addEventListener("click", refreshAll);
  });
  refreshAll();
}

function wireTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activateTab(tab));
    tab.addEventListener("keydown", (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      activateTab(tabs[nextIndex]);
      tabs[nextIndex].focus();
    });
  });
}

function activateTab(activeTab) {
  document.querySelectorAll('[role="tab"]').forEach((tab) => {
    const selected = tab === activeTab;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.querySelector("#" + tab.getAttribute("aria-controls")).hidden = !selected;
  });
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
  document.querySelectorAll("[data-memory-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.memoryFilter = button.dataset.memoryFilter;
      document.querySelectorAll("[data-memory-filter]").forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle("is-active", active);
        candidate.setAttribute("aria-pressed", String(active));
      });
      renderMemories();
    });
  });
}

function wireForms() {
  ui.scopeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.scope = {
      actorId: ui.scopeActor.value.trim(),
      workspaceId: ui.scopeWorkspace.value.trim(),
    };
    if (!state.scope.actorId || !state.scope.workspaceId) return;
    saveScope(state.scope);
    updateScopeLabels();
    ui.scopeDialog.close();
    refreshAll();
  });

  ui.proposalForm.addEventListener("submit", submitProposal);
  ui.proposalSensitivity.addEventListener("change", validateProposalScope);
  ui.proposalTask.addEventListener("change", validateProposalScope);
  ui.forgetForm.addEventListener("submit", submitForget);
  ui.previewForm.addEventListener("submit", submitPreview);
}

async function refreshAll() {
  clearNotice();
  setLoading(ui.proposalList, "Loading proposals…");
  setLoading(ui.memoryList, "Loading retained memory…");
  const results = await Promise.allSettled([loadTasks(), loadProposals(), loadMemories()]);
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    showNotice("Some memory data could not be refreshed. The affected section shows how to retry.", true);
  }
}

async function loadTasks() {
  try {
    state.tasks = await api("/v1/tasks" + scopeQuery());
    populateTaskSelects();
  } catch (error) {
    state.tasks = [];
    populateTaskSelects();
    throw error;
  }
}

async function loadProposals() {
  try {
    state.proposals = await api("/v1/memory-proposals" + scopeQuery("pending"));
    renderProposals();
  } catch (error) {
    renderError(ui.proposalList, friendlyError(error));
    throw error;
  }
}

async function loadMemories() {
  try {
    state.memories = await api("/v1/memories" + scopeQuery());
    renderMemories();
  } catch (error) {
    renderError(ui.memoryList, friendlyError(error));
    throw error;
  }
}

function renderProposals() {
  ui.proposalList.replaceChildren();
  ui.proposalList.setAttribute("aria-busy", "false");
  ui.proposalCount.textContent = String(state.proposals.length);
  if (state.proposals.length === 0) {
    ui.proposalList.append(emptyState("Nothing waiting", "New memory proposals will stay here until you approve or reject them."));
    return;
  }

  state.proposals.forEach((proposal) => {
    const card = baseCard(proposal, "pending");
    const actions = el("div", "card-actions");
    const approve = button("Approve memory", "button button-primary button-small");
    const reject = button("Reject", "button button-secondary button-small");
    approve.addEventListener("click", () => decideProposal(proposal, "approved", [approve, reject]));
    reject.addEventListener("click", () => decideProposal(proposal, "rejected", [approve, reject]));
    actions.append(approve, reject);
    card.append(actions);
    ui.proposalList.append(card);
  });
}

function renderMemories() {
  ui.memoryList.replaceChildren();
  ui.memoryList.setAttribute("aria-busy", "false");
  const filtered = state.memoryFilter === "all"
    ? state.memories
    : state.memories.filter((memory) => memory.state === state.memoryFilter);
  if (filtered.length === 0) {
    ui.memoryList.append(emptyState(
      state.memoryFilter === "active" ? "No active memories" : "No memories in this state",
      state.memoryFilter === "active"
        ? "Approve a proposal to give Jolene durable, reviewable context."
        : "Choose another filter to continue reviewing retained records.",
    ));
    return;
  }

  filtered.forEach((memory) => {
    const card = baseCard(memory, memory.state);
    if (memory.state !== "forgotten") {
      const actions = el("div", "card-actions");
      if (memory.state === "active") {
        const correct = button("Propose correction", "button button-quiet button-small");
        correct.addEventListener("click", () => openCorrection(memory));
        actions.append(correct);
      }
      const forget = button("Forget content", "button button-secondary button-small");
      forget.addEventListener("click", () => openForget(memory));
      actions.append(forget);
      card.append(actions);
    }
    ui.memoryList.append(card);
  });
}

function baseCard(record, stateName) {
  const card = el("article", "memory-card");
  if (record.sensitivity === "sensitive") card.classList.add("is-sensitive");
  const top = el("div", "card-topline");
  const badges = el("div", "badge-row");
  badges.append(
    badge(humanize(record.kind)),
    badge(humanize(record.sensitivity), record.sensitivity === "sensitive" ? "badge-sensitive" : ""),
    badge(humanize(stateName), stateName === "active" ? "badge-active" : "badge-" + stateName),
  );
  top.append(badges);
  const content = el("p", "card-content", record.content);
  const source = el("p", "card-source", record.source ? "Source: " + record.source : "Approved proposal: " + shorten(record.sourceProposalId));
  const meta = el("div", "meta-list");
  meta.append(el("span", "", "Task: " + taskName(record.taskId)));
  if (record.expiresAt) meta.append(el("span", "", "Expires: " + formatDate(record.expiresAt)));
  if (record.createdAt) meta.append(el("span", "", "Created: " + formatDate(record.createdAt)));
  card.append(top, content, source, meta);
  return card;
}

async function decideProposal(proposal, decision, controls) {
  setDisabled(controls, true);
  try {
    await api("/v1/memory-proposals/" + encodeURIComponent(proposal.id) + "/decision", {
      method: "POST",
      body: { ...state.scope, decision },
    });
    showToast(decision === "approved" ? "Memory approved." : "Proposal rejected.");
    await Promise.all([loadProposals(), loadMemories()]);
  } catch (error) {
    showNotice(friendlyError(error), true);
    setDisabled(controls, false);
  }
}

function openNewProposal() {
  ui.proposalForm.reset();
  ui.proposalTask.disabled = false;
  ui.proposalKind.disabled = false;
  ui.proposalReplaces.value = "";
  ui.proposalTitle.textContent = "Propose a memory";
  ui.proposalEyebrow.textContent = "Memory proposal";
  ui.proposalCopy.textContent = "The proposal will wait in the review queue. It will not become memory yet.";
  ui.proposalSubmit.textContent = "Add to review queue";
  ui.proposalSource.value = "Direct proposal from Carl in Memory Review";
  clearInlineError(ui.proposalError);
  ui.proposalDialog.showModal();
  ui.proposalContent.focus();
}

function openCorrection(memory) {
  ui.proposalForm.reset();
  ui.proposalReplaces.value = memory.id;
  ui.proposalContent.value = memory.content;
  ui.proposalKind.value = memory.kind;
  ui.proposalTask.value = memory.taskId || "";
  ui.proposalSensitivity.value = memory.sensitivity;
  ui.proposalExpiry.value = toLocalDateTime(memory.expiresAt);
  ui.proposalSource.value = "Correction proposed by Carl in Memory Review";
  ui.proposalTask.disabled = true;
  ui.proposalKind.disabled = false;
  ui.proposalTitle.textContent = "Propose a correction";
  ui.proposalEyebrow.textContent = "Reviewed replacement";
  ui.proposalCopy.textContent = "The original stays active until this correction is approved.";
  ui.proposalSubmit.textContent = "Add correction to queue";
  clearInlineError(ui.proposalError);
  ui.proposalDialog.showModal();
  ui.proposalContent.focus();
}

async function submitProposal(event) {
  event.preventDefault();
  if (!validateProposalScope()) return;
  clearInlineError(ui.proposalError);
  ui.proposalSubmit.disabled = true;
  const expiry = ui.proposalExpiry.value
    ? new Date(ui.proposalExpiry.value).toISOString()
    : null;
  try {
    await api("/v1/memory-proposals", {
      method: "POST",
      body: {
        ...state.scope,
        taskId: ui.proposalTask.value || null,
        kind: ui.proposalKind.value,
        content: ui.proposalContent.value.trim(),
        source: ui.proposalSource.value.trim(),
        sensitivity: ui.proposalSensitivity.value,
        expiresAt: expiry,
        replacesMemoryId: ui.proposalReplaces.value || null,
      },
    });
    ui.proposalDialog.close();
    showToast(ui.proposalReplaces.value ? "Correction added to review." : "Memory added to review.");
    await loadProposals();
    activateTab(document.querySelector("#tab-review"));
  } catch (error) {
    showInlineError(ui.proposalError, friendlyError(error));
  } finally {
    ui.proposalSubmit.disabled = false;
  }
}

function validateProposalScope() {
  const taskRequired = ui.proposalSensitivity.value !== "private";
  const valid = !taskRequired || Boolean(ui.proposalTask.value);
  if (!valid) {
    showInlineError(ui.proposalError, "Restricted and sensitive memories need a selected task.");
  } else {
    clearInlineError(ui.proposalError);
  }
  return valid;
}

function openForget(memory) {
  ui.forgetId.value = memory.id;
  ui.forgetContent.textContent = memory.content;
  clearInlineError(ui.forgetError);
  ui.forgetDialog.showModal();
  ui.forgetSubmit.focus();
}

async function submitForget(event) {
  event.preventDefault();
  ui.forgetSubmit.disabled = true;
  clearInlineError(ui.forgetError);
  try {
    await api("/v1/memories/" + encodeURIComponent(ui.forgetId.value) + "/forget", {
      method: "POST",
      body: state.scope,
    });
    ui.forgetDialog.close();
    showToast("Memory content forgotten.");
    await Promise.all([loadMemories(), loadProposals()]);
  } catch (error) {
    showInlineError(ui.forgetError, friendlyError(error));
  } finally {
    ui.forgetSubmit.disabled = false;
  }
}

async function submitPreview(event) {
  event.preventDefault();
  const submit = ui.previewForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  setLoading(ui.previewResults, "Selecting authorized context…");
  try {
    const result = await api("/v1/context-preview", {
      method: "POST",
      body: {
        ...state.scope,
        taskId: ui.previewTask.value || null,
        query: ui.previewQuery.value.trim(),
        includeSensitiveMemory: ui.previewSensitive.checked,
        memoryLimit: 24,
      },
    });
    renderPreview(result);
  } catch (error) {
    renderError(ui.previewResults, friendlyError(error));
  } finally {
    submit.disabled = false;
  }
}

function renderPreview(result) {
  ui.previewResults.replaceChildren();
  ui.previewResults.setAttribute("aria-busy", "false");
  const selection = result.selection || {};
  const summary = el(
    "div",
    "preview-summary",
    "Jolene selected " + result.memories.length + " of " + (selection.candidateCount || 0) + " authorized candidates.",
  );
  ui.previewResults.append(summary);
  if (result.memories.length === 0) {
    ui.previewResults.append(emptyState("No relevant memory selected", "Jolene would answer from the current request, task, conversation, and permitted tools."));
    return;
  }
  const list = el("div", "card-grid");
  result.memories.forEach((memory) => {
    const evidence = (selection.evidence || []).find((item) => item.memoryId === memory.id);
    const card = baseCard(memory, memory.state);
    const top = card.querySelector(".card-topline");
    top.append(el("span", "score", String(evidence ? evidence.score : 0)));
    if (evidence) {
      const meta = card.querySelector(".meta-list");
      meta.append(el("span", "", "Why selected: " + evidence.reasons.map(humanize).join(", ")));
      if (evidence.matchedTerms.length > 0) {
        meta.append(el("span", "", "Matched: " + evidence.matchedTerms.join(", ")));
      }
    }
    list.append(card);
  });
  ui.previewResults.append(list);
}

function populateTaskSelects() {
  const selects = [ui.previewTask, ui.proposalTask];
  selects.forEach((select) => {
    const current = select.value;
    const firstLabel = select === ui.previewTask ? "No selected task" : "Global private memory";
    select.replaceChildren(option("", firstLabel));
    state.tasks.forEach((task) => select.append(option(task.id, task.title + " · " + humanize(task.status))));
    if ([...select.options].some((candidate) => candidate.value === current)) select.value = current;
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

function scopeQuery(status) {
  const params = new URLSearchParams(state.scope);
  if (status) params.set("status", status);
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
  if (error && error.message === "decision_conflict") return "That proposal was already decided differently. Refresh to see its current state.";
  if (error && error.message === "memory_conflict") return "That memory changed before this action completed. Refresh and review its current state.";
  if (error && error.message === "invalid_request") return "Some information is missing or invalid. Review the fields and try again.";
  if (error && error.status === 404) return "That record is no longer available in this memory scope.";
  return "Jolene’s local memory service is unavailable. Check that the local service is running, then retry.";
}

function taskName(taskId) {
  if (!taskId) return "Global private memory";
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  return task ? task.title : "Task " + shorten(taskId);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Unknown date"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function toLocalDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const local = new Date(date.valueOf() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function humanize(value) {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shorten(value) {
  return value && value.length > 12 ? value.slice(0, 8) + "…" : value || "unknown";
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
  node.append(el("strong", "", "Couldn’t load this section"), el("p", "", message));
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
  toastTimer = window.setTimeout(() => { ui.toast.hidden = true; }, 3200);
}

function setDisabled(controls, disabled) {
  controls.forEach((control) => { control.disabled = disabled; });
}
