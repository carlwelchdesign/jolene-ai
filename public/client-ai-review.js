const state = {
  scope: null,
  recipients: [],
  tasks: [],
  packets: [],
  filter: "all",
};

const ui = {
  scopeLabel: document.querySelector("#scope-label"),
  notice: document.querySelector("#page-notice"),
  createButton: document.querySelector("#create-button"),
  refreshButton: document.querySelector("#refresh-button"),
  packetList: document.querySelector("#packet-list"),
  countDraft: document.querySelector("#count-draft"),
  countActive: document.querySelector("#count-active"),
  countHandoff: document.querySelector("#count-handoff"),
  countClosed: document.querySelector("#count-closed"),
  createDialog: document.querySelector("#create-dialog"),
  createForm: document.querySelector("#create-form"),
  createTask: document.querySelector("#create-task"),
  createRecipient: document.querySelector("#create-recipient"),
  createPurpose: document.querySelector("#create-purpose"),
  createTurnLimit: document.querySelector("#create-turn-limit"),
  createExpiry: document.querySelector("#create-expiry"),
  contextItems: document.querySelector("#context-items"),
  addContextButton: document.querySelector("#add-context-button"),
  createQuestions: document.querySelector("#create-questions"),
  createError: document.querySelector("#create-error"),
  createSubmit: document.querySelector("#create-submit"),
  decisionDialog: document.querySelector("#decision-dialog"),
  decisionForm: document.querySelector("#decision-form"),
  decisionId: document.querySelector("#decision-id"),
  decisionDetails: document.querySelector("#decision-details"),
  decisionError: document.querySelector("#decision-error"),
  decisionReject: document.querySelector("#decision-reject"),
  decisionApprove: document.querySelector("#decision-approve"),
  cancelDialog: document.querySelector("#cancel-dialog"),
  cancelForm: document.querySelector("#cancel-form"),
  cancelId: document.querySelector("#cancel-id"),
  cancelError: document.querySelector("#cancel-error"),
  cancelSubmit: document.querySelector("#cancel-submit"),
  handoffDialog: document.querySelector("#handoff-dialog"),
  handoffForm: document.querySelector("#handoff-form"),
  handoffPacketId: document.querySelector("#handoff-packet-id"),
  handoffId: document.querySelector("#handoff-id"),
  handoffDetails: document.querySelector("#handoff-details"),
  handoffFeedback: document.querySelector("#handoff-feedback"),
  handoffError: document.querySelector("#handoff-error"),
  handoffSubmit: document.querySelector("#handoff-submit"),
  toast: document.querySelector("#toast"),
};

initialize();

function initialize() {
  wireDialogs();
  wireFilters();
  ui.createButton.addEventListener("click", openCreateDialog);
  ui.refreshButton.addEventListener("click", refreshAll);
  ui.addContextButton.addEventListener("click", () => addContextEditor());
  ui.createForm.addEventListener("submit", submitCreate);
  ui.decisionForm.addEventListener("submit", (event) => submitDecision(event, "approved"));
  ui.decisionReject.addEventListener("click", (event) => submitDecision(event, "rejected"));
  ui.cancelForm.addEventListener("submit", submitCancel);
  ui.handoffForm.addEventListener("submit", submitHandoffReview);
  refreshAll();
}

function wireDialogs() {
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
  document.querySelectorAll("[data-packet-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.packetFilter;
      document.querySelectorAll("[data-packet-filter]").forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle("is-active", active);
        candidate.setAttribute("aria-pressed", String(active));
      });
      renderPackets();
    });
  });
}

async function refreshAll() {
  clearNotice();
  setLoading(ui.packetList, "Loading coordination packets…");
  try {
    const [scope, recipients] = await Promise.all([
      api("/v1/client-ai-scope"),
      api("/v1/client-ai-recipients"),
    ]);
    state.scope = scope;
    state.recipients = recipients;
    ui.scopeLabel.textContent = scope.actorId + " · " + scope.workspaceId;
    const [tasks, packets] = await Promise.all([
      api("/v1/tasks?" + new URLSearchParams(scope).toString()),
      api("/v1/client-ai-packets?limit=100"),
    ]);
    state.tasks = tasks;
    state.packets = packets;
    populateCreateOptions();
    renderSummary();
    renderPackets();
  } catch (error) {
    renderError(ui.packetList, friendlyError(error));
    showNotice("Client-AI review data could not be refreshed. No packet state was changed.", true);
  }
}

function renderSummary() {
  ui.countDraft.textContent = String(countStatus("draft"));
  ui.countActive.textContent = String(state.packets.filter((packet) => ["approved", "active"].includes(packet.status)).length);
  ui.countHandoff.textContent = String(countStatus("handoff_required"));
  ui.countClosed.textContent = String(countStatus("closed"));
}

function countStatus(status) {
  return state.packets.filter((packet) => packet.status === status).length;
}

function renderPackets() {
  ui.packetList.replaceChildren();
  ui.packetList.setAttribute("aria-busy", "false");
  const packets = state.packets.filter((packet) => {
    if (state.filter === "all") return true;
    if (state.filter === "other") {
      return ["rejected", "cancelled", "expired"].includes(packet.status);
    }
    return packet.status === state.filter;
  });
  if (packets.length === 0) {
    ui.packetList.append(emptyState(
      state.filter === "all" ? "No coordination packets yet" : "Nothing in this state",
      state.filter === "all"
        ? "Create a draft when an owner task needs a bounded Jenny or Maria handoff."
        : "Choose another filter or refresh to review current packet state.",
    ));
    return;
  }
  packets.forEach((packet) => ui.packetList.append(packetCard(packet)));
}

function packetCard(packet) {
  const card = el("article", "packet-card");
  if (packet.status === "handoff_required") card.classList.add("is-handoff");
  const top = el("div", "card-topline");
  const badges = el("div", "badge-row");
  badges.append(
    badge(packet.recipient.label),
    badge(humanize(packet.status), "badge-" + packet.status),
    badge(packet.turnLimit + " turn max"),
  );
  top.append(badges, el("time", "card-time", formatDate(packet.updatedAt)));
  card.append(top);

  const titleRow = el("div", "packet-title-row");
  const title = el("div");
  title.append(
    el("h3", "", packet.recipient.label + " · " + packet.recipient.projectId),
    el("p", "", "Task: " + taskName(packet.taskId)),
  );
  const progress = el("div", "packet-progress");
  progress.append(
    el("strong", "", packet.turnsUsed + " / " + packet.turnLimit),
    el("span", "", packet.nextSpeaker ? "Next: " + humanize(packet.nextSpeaker) : "No next speaker"),
  );
  titleRow.append(title, progress);
  card.append(titleRow, el("p", "packet-purpose", packet.purpose));

  const meta = el("div", "meta-list");
  meta.append(
    el("span", "", "Created: " + formatDate(packet.createdAt)),
    el("span", "", "Expires: " + formatDate(packet.expiresAt)),
    el("span", "", "Exact sender: " + packet.recipient.senderIdentity),
  );
  card.append(meta, el("p", "packet-fingerprint", "SHA-256 · " + packet.payloadFingerprint));

  const sections = el("div", "packet-sections");
  sections.append(contextSection(packet), questionsSection(packet));
  if (packet.transcript.length > 0) sections.append(transcriptSection(packet));
  if (packet.handoffs.length > 0) sections.append(handoffSection(packet));
  card.append(sections);

  const actions = packetActions(packet);
  if (actions.childElementCount > 0) card.append(actions);
  return card;
}

function contextSection(packet) {
  const section = packetSection("Approved context");
  const list = el("ul");
  packet.contextItems.forEach((item) => {
    const row = el("li", "context-item");
    row.append(el("strong", "", item.label), el("p", "", item.content));
    row.append(badge(humanize(item.dataClass)), badge(humanize(item.sourceKind)));
    list.append(row);
  });
  section.append(list);
  return section;
}

function questionsSection(packet) {
  const section = packetSection("Questions");
  const list = el("ul");
  packet.questions.forEach((question, index) => list.append(el("li", "", (index + 1) + ". " + question)));
  section.append(list);
  return section;
}

function transcriptSection(packet) {
  const section = packetSection("Append-only transcript");
  const list = el("ol", "transcript-list");
  packet.transcript.forEach((turn) => {
    const row = el("li", "transcript-turn" + (turn.speaker === "external_ai" ? " is-external" : ""));
    const header = el("header");
    header.append(
      el("span", "", turn.sequence + " · " + humanize(turn.speaker) + " · " + turn.senderIdentity),
      el("time", "", formatDate(turn.createdAt)),
    );
    row.append(header, el("p", "", turn.content));
    list.append(row);
  });
  section.append(list);
  return section;
}

function handoffSection(packet) {
  const section = packetSection("Handoff history");
  const list = el("ol", "handoff-list");
  packet.handoffs.forEach((handoff) => {
    const row = el("li", "handoff-item");
    row.append(
      el("strong", "", "Version " + handoff.version + " · " + humanize(handoff.status)),
      el("p", "", handoff.summary),
      el("p", "", "Proposed next action: " + handoff.proposedNextAction),
    );
    if (handoff.reviewFeedback) row.append(el("p", "", "Owner feedback: " + handoff.reviewFeedback));
    list.append(row);
  });
  section.append(list);
  return section;
}

function packetActions(packet) {
  const actions = el("div", "card-actions");
  if (packet.status === "draft") {
    const review = button("Review exact draft", "button button-primary button-small");
    review.addEventListener("click", () => openDecision(packet));
    actions.append(review);
  }
  const latestHandoff = packet.handoffs.at(-1);
  if (packet.status === "handoff_required" && latestHandoff?.status === "pending_review") {
    const reviewHandoff = button("Review latest handoff", "button button-primary button-small");
    reviewHandoff.addEventListener("click", () => openHandoffReview(packet, latestHandoff));
    actions.append(reviewHandoff);
  }
  if (["draft", "approved", "active", "handoff_required"].includes(packet.status)) {
    const cancel = button("Cancel packet", "button button-secondary button-small");
    cancel.addEventListener("click", () => openCancel(packet));
    actions.append(cancel);
  }
  return actions;
}

function packetSection(title) {
  const section = el("section", "packet-section");
  section.append(el("h4", "", title));
  return section;
}

function openCreateDialog() {
  ui.createForm.reset();
  ui.contextItems.replaceChildren();
  addContextEditor();
  ui.createTurnLimit.value = "3";
  ui.createExpiry.value = toLocalDateTime(new Date(Date.now() + 60 * 60 * 1000));
  ui.createExpiry.min = toLocalDateTime(new Date(Date.now() + 60 * 1000));
  ui.createExpiry.max = toLocalDateTime(new Date(Date.now() + 24 * 60 * 60 * 1000));
  clearInlineError(ui.createError);
  ui.createDialog.showModal();
  ui.createTask.focus();
}

function addContextEditor() {
  if (ui.contextItems.childElementCount >= 8) return;
  const editor = el("div", "context-editor");
  editor.dataset.contextEditor = "true";
  const label = field("Label", "input", { maxlength: "120", required: "", className: "context-label" });
  const dataClass = selectField("Data class", "context-data-class", [
    ["general", "General"], ["private", "Private"], ["restricted", "Restricted"],
  ]);
  const sourceKind = selectField("Source type", "context-source-kind", [
    ["task_context", "Task context"],
    ["approved_summary", "Approved summary"],
    ["approved_public_evidence", "Approved public evidence"],
    ["workflow_state", "Workflow state"],
  ]);
  const content = field("Minimized context", "textarea", {
    maxlength: "2000", required: "", rows: "4", className: "context-content-input",
  });
  content.classList.add("context-content");
  const actions = el("div", "context-editor-actions");
  const remove = button("Remove item", "button button-quiet button-small");
  remove.addEventListener("click", () => {
    if (ui.contextItems.childElementCount > 1) editor.remove();
    updateContextControls();
  });
  actions.append(remove);
  editor.append(label, dataClass, sourceKind, content, actions);
  ui.contextItems.append(editor);
  updateContextControls();
}

function updateContextControls() {
  ui.addContextButton.disabled = ui.contextItems.childElementCount >= 8;
  ui.contextItems.querySelectorAll(".context-editor-actions button").forEach((control) => {
    control.disabled = ui.contextItems.childElementCount <= 1;
  });
}

async function submitCreate(event) {
  event.preventDefault();
  clearInlineError(ui.createError);
  const questions = ui.createQuestions.value.split("\n").map((value) => value.trim()).filter(Boolean);
  const contextItems = [...ui.contextItems.querySelectorAll("[data-context-editor]")].map((editor) => ({
    label: editor.querySelector(".context-label").value.trim(),
    content: editor.querySelector(".context-content-input").value.trim(),
    dataClass: editor.querySelector(".context-data-class").value,
    sourceKind: editor.querySelector(".context-source-kind").value,
  }));
  if (questions.length < 1 || questions.length > 8) {
    showInlineError(ui.createError, "Enter between one and eight questions, one per line.");
    return;
  }
  if (new Set(contextItems.map((item) => item.label.toLowerCase())).size !== contextItems.length) {
    showInlineError(ui.createError, "Each context item needs a unique label.");
    return;
  }
  if (contextItems.reduce((total, item) => total + item.content.length, 0) > 12_000) {
    showInlineError(ui.createError, "Approved context exceeds the 12,000-character packet limit.");
    return;
  }
  setDisabled([ui.createSubmit], true);
  try {
    await api("/v1/client-ai-packets", {
      method: "POST",
      body: {
        taskId: ui.createTask.value,
        recipientId: ui.createRecipient.value,
        purpose: ui.createPurpose.value.trim(),
        contextItems,
        questions,
        turnLimit: Number(ui.createTurnLimit.value),
        expiresAt: new Date(ui.createExpiry.value).toISOString(),
      },
    });
    ui.createDialog.close();
    showToast("Draft packet created. No conversation was started.");
    await loadPackets();
  } catch (error) {
    showInlineError(ui.createError, friendlyError(error));
  } finally {
    setDisabled([ui.createSubmit], false);
  }
}

function openDecision(packet) {
  ui.decisionId.value = packet.id;
  ui.decisionDetails.replaceChildren();
  addReviewRow(ui.decisionDetails, "Recipient", packet.recipient.label + " · " + packet.recipient.projectId + " · " + packet.recipient.senderIdentity);
  addReviewRow(ui.decisionDetails, "Owner task", taskName(packet.taskId));
  addReviewRow(ui.decisionDetails, "Purpose", packet.purpose);
  addReviewRow(ui.decisionDetails, "Context", packet.contextItems.map((item) => item.label + " [" + humanize(item.dataClass) + " / " + humanize(item.sourceKind) + "]\n" + item.content).join("\n\n"));
  addReviewRow(ui.decisionDetails, "Questions", packet.questions.map((value, index) => (index + 1) + ". " + value).join("\n"));
  addReviewRow(ui.decisionDetails, "Turn / expiry", packet.turnLimit + " Jolene turns · " + formatDate(packet.expiresAt));
  addReviewRow(ui.decisionDetails, "SHA-256", packet.payloadFingerprint);
  clearInlineError(ui.decisionError);
  ui.decisionDialog.showModal();
  ui.decisionApprove.focus();
}

async function submitDecision(event, decision) {
  event.preventDefault();
  const packet = state.packets.find((candidate) => candidate.id === ui.decisionId.value);
  if (!packet) return;
  setDisabled([ui.decisionApprove, ui.decisionReject], true);
  clearInlineError(ui.decisionError);
  try {
    await api("/v1/client-ai-packets/" + encodeURIComponent(packet.id) + "/decision", {
      method: "POST",
      body: { decision, expectedFingerprint: packet.payloadFingerprint },
    });
    ui.decisionDialog.close();
    showToast(decision === "approved"
      ? "Exact packet approved. No message was authorized or sent."
      : "Packet rejected. No message was authorized or sent.");
    await loadPackets();
  } catch (error) {
    showInlineError(ui.decisionError, friendlyError(error));
  } finally {
    setDisabled([ui.decisionApprove, ui.decisionReject], false);
  }
}

function openCancel(packet) {
  ui.cancelId.value = packet.id;
  clearInlineError(ui.cancelError);
  ui.cancelDialog.showModal();
  ui.cancelSubmit.focus();
}

async function submitCancel(event) {
  event.preventDefault();
  setDisabled([ui.cancelSubmit], true);
  clearInlineError(ui.cancelError);
  try {
    await api("/v1/client-ai-packets/" + encodeURIComponent(ui.cancelId.value) + "/cancel", {
      method: "POST",
      body: {},
    });
    ui.cancelDialog.close();
    showToast("Packet cancelled. Its audit history remains available.");
    await loadPackets();
  } catch (error) {
    showInlineError(ui.cancelError, friendlyError(error));
  } finally {
    setDisabled([ui.cancelSubmit], false);
  }
}

function openHandoffReview(packet, handoff) {
  ui.handoffPacketId.value = packet.id;
  ui.handoffId.value = handoff.id;
  ui.handoffDetails.replaceChildren();
  addReviewRow(ui.handoffDetails, "Version", String(handoff.version));
  addReviewRow(ui.handoffDetails, "Summary", handoff.summary);
  addReviewRow(ui.handoffDetails, "Decisions", listText(handoff.decisions));
  addReviewRow(ui.handoffDetails, "Open questions", listText(handoff.unresolvedQuestions));
  addReviewRow(ui.handoffDetails, "Proposed next action", handoff.proposedNextAction);
  ui.handoffForm.elements.namedItem("handoff-decision").value = "approved";
  ui.handoffFeedback.value = "";
  clearInlineError(ui.handoffError);
  ui.handoffDialog.showModal();
  ui.handoffSubmit.focus();
}

async function submitHandoffReview(event) {
  event.preventDefault();
  const decision = ui.handoffForm.elements.namedItem("handoff-decision").value;
  const feedback = ui.handoffFeedback.value.trim();
  if (decision === "changes_requested" && !feedback) {
    showInlineError(ui.handoffError, "Explain what should change before returning this handoff.");
    return;
  }
  setDisabled([ui.handoffSubmit], true);
  clearInlineError(ui.handoffError);
  try {
    await api(
      "/v1/client-ai-packets/" + encodeURIComponent(ui.handoffPacketId.value) +
      "/handoffs/" + encodeURIComponent(ui.handoffId.value) + "/review",
      { method: "POST", body: { decision, feedback } },
    );
    ui.handoffDialog.close();
    showToast(decision === "approved"
      ? "Handoff approved and packet closed."
      : "Handoff returned for revision.");
    await loadPackets();
  } catch (error) {
    showInlineError(ui.handoffError, friendlyError(error));
  } finally {
    setDisabled([ui.handoffSubmit], false);
  }
}

async function loadPackets() {
  state.packets = await api("/v1/client-ai-packets?limit=100");
  renderSummary();
  renderPackets();
}

function populateCreateOptions() {
  ui.createTask.replaceChildren(option("", "Choose a task"));
  state.tasks
    .filter((task) => !["completed", "cancelled"].includes(task.status))
    .forEach((task) => ui.createTask.append(option(task.id, task.title + " · " + humanize(task.status))));
  ui.createRecipient.replaceChildren(option("", "Choose a recipient"));
  state.recipients.forEach((recipient) => {
    ui.createRecipient.append(option(recipient.id, recipient.label + " · " + recipient.projectId));
  });
}

function field(labelText, controlType, attributes) {
  const label = el("label", "field");
  const control = document.createElement(controlType);
  Object.entries(attributes).forEach(([key, value]) => {
    if (key === "className") control.className = value;
    else control.setAttribute(key, value);
  });
  label.append(el("span", "", labelText), control);
  return label;
}

function selectField(labelText, className, values) {
  const label = el("label", "field");
  const select = el("select", className);
  values.forEach(([value, text]) => select.append(option(value, text)));
  label.append(el("span", "", labelText), select);
  return label;
}

function addReviewRow(container, label, value) {
  container.append(el("dt", "", label), el("dd", "", value || "None recorded"));
}

function listText(values) {
  return values.length ? values.map((value, index) => (index + 1) + ". " + value).join("\n") : "None recorded";
}

function taskName(taskId) {
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
  if (error && error.message === "client_ai_packet_expired") return "This packet expired. Create a fresh draft with current context.";
  if (error && error.message === "client_ai_packet_policy_blocked") return "The packet violates its 24-hour or disclosure policy boundary.";
  if (error && error.message === "action_conflict") return "This packet changed before the action completed. Refresh and review its current state.";
  if (error && error.message === "request_origin_not_permitted") return "This mutation is allowed only from Jolene’s local control center.";
  if (error && error.message === "invalid_request") return "Some packet information is missing or invalid. Review the task, context, questions, limits, and expiry.";
  if (error && error.status === 404) return "That packet or handoff is no longer available in the private owner scope.";
  return "Jolene’s local packet service is unavailable. Check the local service, then retry.";
}

function el(tag, className = "", text) {
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
  node.append(el("strong", "", "Couldn’t load client-AI packets"), el("p", "", message));
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

function setDisabled(controls, disabled) {
  controls.forEach((control) => { control.disabled = disabled; });
}

let toastTimer;
function showToast(message) {
  window.clearTimeout(toastTimer);
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  toastTimer = window.setTimeout(() => { ui.toast.hidden = true; }, 3600);
}
