const dimensions = ["accuracy", "grounding", "usefulness", "tone"];
const state = { scope: null, snapshot: null };

const ui = {
  scopeChip: document.querySelector("#scope-chip"),
  notice: document.querySelector("#page-notice"),
  refreshButton: document.querySelector("#refresh-button"),
  summaryPacket: document.querySelector("#summary-packet"),
  summaryCases: document.querySelector("#summary-cases"),
  summaryReview: document.querySelector("#summary-review"),
  packetMeta: document.querySelector("#packet-meta"),
  packetState: document.querySelector("#packet-state"),
  decisionPanel: document.querySelector("#decision-panel"),
  reviewForm: document.querySelector("#review-form"),
  caseReviews: document.querySelector("#case-reviews"),
  overallDecision: document.querySelector("#overall-decision"),
  decisionGuidance: document.querySelector("#decision-guidance"),
  reviewError: document.querySelector("#review-error"),
  reviewSubmit: document.querySelector("#review-submit"),
  toast: document.querySelector("#toast"),
};

ui.refreshButton.addEventListener("click", refresh);
ui.reviewForm.addEventListener("submit", saveReview);
ui.reviewForm.addEventListener("input", updateSubmitState);
ui.overallDecision.addEventListener("change", updateSubmitState);
refresh();

async function refresh() {
  clearNotice();
  ui.refreshButton.disabled = true;
  setLoading();
  try {
    state.scope = await api("/v1/public-live-model-review/scope");
    ui.scopeChip.replaceChildren(
      el("span", "", "●", { "aria-hidden": "true" }),
      document.createTextNode(`${state.scope.actorId} · ${state.scope.workspaceId}`),
    );
    state.snapshot = await api(`/v1/public-live-model-review${scopeQuery()}`);
    renderSnapshot();
  } catch (error) {
    renderRequestError(friendlyError(error));
  } finally {
    ui.refreshButton.disabled = false;
  }
}

function renderSnapshot() {
  const { packetStatus, reviewStatus, packet, decision } = state.snapshot;
  ui.summaryPacket.textContent = title(packetStatus);
  ui.summaryCases.textContent = packet ? String(packet.cases.length) : "—";
  ui.summaryReview.textContent = reviewLabel(reviewStatus);
  ui.packetMeta.replaceChildren();
  ui.packetState.setAttribute("aria-busy", "false");
  ui.decisionPanel.hidden = true;

  if (packetStatus === "missing") {
    renderEmpty(
      "No review packet yet",
      "The opt-in live-model evaluation has not produced a packet at this configured private path. No provider call can be started from this page.",
    );
    return;
  }
  if (packetStatus === "malformed") {
    renderEmpty(
      "Review packet rejected",
      "The packet failed schema validation. Keep it private, regenerate it through the evaluation workflow, and do not make a decision from this file.",
      true,
    );
    return;
  }

  renderMeta(packet);
  renderCases(packet);
  renderDecisionForm(packet, reviewStatus, decision);
}

function renderMeta(packet) {
  const entries = [
    ["Suite", packet.suiteId],
    ["Model", packet.model],
    ["Generated", formatDate(packet.generatedAt)],
    ["Suite hash", packet.suiteHash],
  ];
  for (const [label, value] of entries) {
    ui.packetMeta.append(el("dt", "", label), el("dd", "", value));
  }
}

function renderCases(packet) {
  const stack = el("div", "case-stack");
  packet.cases.forEach((item, index) => stack.append(caseCard(item, index)));
  ui.packetState.replaceChildren(stack);
}

function caseCard(item, index) {
  const card = el("article", "evaluation-case");
  const header = el("div", "case-header");
  const titleBlock = el("div");
  titleBlock.append(
    el("p", "eyebrow", `Case ${index + 1} · ${item.id}`),
    el("h3", "", item.question),
  );
  header.append(titleBlock, el("span", "case-mode", item.mode));
  card.append(header);

  const answer = el("div", "answer-block");
  answer.append(el("strong", "", "Public Jolene answer"), document.createTextNode(item.answer));
  card.append(answer);

  const evidence = el("div", "evidence-block");
  evidence.append(el("strong", "", "Reviewed public evidence supplied"));
  if (item.evidence.length === 0) {
    evidence.append(el("p", "no-evidence", "No evidence was supplied; this case should bypass the provider."));
  } else {
    item.evidence.forEach((record) => evidence.append(evidenceItem(record)));
  }
  card.append(evidence);
  return card;
}

function evidenceItem(record) {
  const item = el("div", "evidence-item");
  item.append(
    el("h4", "", `${record.citationTitle} · ${record.evidenceId}`),
    el("p", "", record.claimText),
  );
  if (record.limitations.length > 0) {
    const list = el("ul");
    record.limitations.forEach((limitation) => list.append(el("li", "", limitation)));
    item.append(list);
  }
  return item;
}

function renderDecisionForm(packet, reviewStatus, decision) {
  ui.decisionPanel.hidden = false;
  ui.caseReviews.replaceChildren();
  ui.reviewForm.reset();
  clearInlineError();

  if (reviewStatus === "stale") {
    const warning = el("div", "historical-decision");
    warning.append(
      el("strong", "", "Previous decision is stale."),
      document.createTextNode(" The suite hash changed, so the earlier review cannot approve this packet. Review every case again."),
    );
    ui.caseReviews.append(warning);
  } else if (reviewStatus === "decision_malformed") {
    const warning = el("div", "historical-decision");
    warning.append(
      el("strong", "", "Saved decision rejected."),
      document.createTextNode(" The local decision file failed validation and does not count as human review."),
    );
    ui.caseReviews.append(warning);
  }

  const canPrefill = reviewStatus === "complete" && decision;
  packet.cases.forEach((item, index) => {
    const existing = canPrefill
      ? decision.cases.find((candidate) => candidate.caseId === item.id)
      : null;
    ui.caseReviews.append(reviewFields(item, index, existing));
  });
  if (canPrefill) ui.overallDecision.value = decision.overall;
  updateSubmitState();
}

function reviewFields(item, index, existing) {
  const section = el("fieldset", "case-review", "", { "data-case-id": item.id });
  const legend = el("legend", "sr-only", `Human review for case ${index + 1}`);
  section.append(legend, el("h3", "", `Case ${index + 1} review`));
  const grid = el("div", "rating-grid");
  dimensions.forEach((dimension) => {
    const id = `case-${index}-${dimension}`;
    const label = el("label", "", "", { for: id });
    label.append(document.createTextNode(title(dimension)), ratingSelect(id, dimension, existing?.[dimension]));
    grid.append(label);
  });
  section.append(grid);
  const notesId = `case-${index}-notes`;
  const notes = el("label", "review-notes", "", { for: notesId });
  const textarea = el("textarea", "", "", { id: notesId, maxlength: "2000", "data-review-notes": "true" });
  textarea.value = existing?.notes || "";
  notes.append(document.createTextNode("Review notes (optional)"), textarea);
  section.append(notes);
  return section;
}

function ratingSelect(id, dimension, value) {
  const select = el("select", "", "", { id, required: "", "data-rating": dimension });
  select.append(
    option("", "Choose"),
    option("pass", "Pass"),
    option("needs_changes", "Needs changes"),
    option("fail", "Fail"),
  );
  select.value = value || "";
  return select;
}

async function saveReview(event) {
  event.preventDefault();
  clearInlineError();
  if (!formComplete()) return;
  ui.reviewSubmit.disabled = true;
  try {
    const cases = [...ui.caseReviews.querySelectorAll("[data-case-id]")].map((container) => ({
      caseId: container.dataset.caseId,
      ...Object.fromEntries(dimensions.map((dimension) => [
        dimension,
        container.querySelector(`[data-rating="${dimension}"]`).value,
      ])),
      notes: container.querySelector("[data-review-notes]").value.trim(),
    }));
    await api("/v1/public-live-model-review/decision", {
      method: "POST",
      body: {
        ...state.scope,
        suiteHash: state.snapshot.packet.suiteHash,
        overall: ui.overallDecision.value,
        cases,
      },
    });
    showToast("Human review saved for this exact suite hash.");
    await refresh();
  } catch (error) {
    showInlineError(friendlyError(error));
  } finally {
    updateSubmitState();
  }
}

function updateSubmitState() {
  const complete = formComplete();
  const ratings = [...ui.caseReviews.querySelectorAll("[data-rating]")].map((control) => control.value);
  const overall = ui.overallDecision.value;
  const coherent = overall === "approved"
    ? ratings.length > 0 && ratings.every((rating) => rating === "pass")
    : overall === "needs_changes"
      ? ratings.includes("needs_changes")
      : overall === "rejected"
        ? ratings.includes("fail")
        : false;
  ui.reviewSubmit.disabled = !(complete && coherent);
  ui.decisionGuidance.textContent = complete && !coherent
    ? "The overall decision does not match the case ratings yet."
    : "Approval requires every dimension to pass. Needs changes requires at least one matching rating; rejection requires at least one failure.";
}

function formComplete() {
  const ratings = [...ui.caseReviews.querySelectorAll("[data-rating]")];
  return ratings.length > 0 && ratings.every((control) => control.value) && Boolean(ui.overallDecision.value);
}

function renderEmpty(titleText, copy, isError = false) {
  const empty = el("div", isError ? "error-state" : "empty-state");
  empty.append(el("strong", "", titleText), el("p", "", copy));
  ui.packetState.replaceChildren(empty);
}

function renderRequestError(message) {
  ui.summaryPacket.textContent = "Unavailable";
  ui.summaryCases.textContent = "—";
  ui.summaryReview.textContent = "Unavailable";
  ui.packetMeta.replaceChildren();
  ui.decisionPanel.hidden = true;
  ui.packetState.setAttribute("aria-busy", "false");
  renderEmpty("Evaluation review unavailable", message, true);
}

function setLoading() {
  ui.packetState.setAttribute("aria-busy", "true");
  ui.packetState.replaceChildren(el("div", "loading-state", "Loading the owner-only review packet…"));
  ui.decisionPanel.hidden = true;
}

function scopeQuery() {
  return `?${new URLSearchParams(state.scope).toString()}`;
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
    const error = new Error(body?.error || "request_failed");
    error.status = response.status;
    throw error;
  }
  return body;
}

function friendlyError(error) {
  if (error?.message === "public_live_review_scope_not_permitted") return "This review is available only in Carl's configured owner scope.";
  if (error?.message === "public_live_review_conflict") return "The packet changed or a case is incomplete. Refresh and review the current packet.";
  if (error?.message === "public_live_review_unavailable") return "The review packet is unavailable or invalid.";
  if (error?.message === "invalid_request") return "The review is incomplete or its overall decision does not match the case ratings.";
  return "Jolene's local evaluation review service is unavailable. Check that the private service is running, then retry.";
}

function reviewLabel(status) {
  return ({
    unavailable: "Unavailable",
    unreviewed: "Required",
    decision_malformed: "Decision rejected",
    stale: "Stale",
    complete: "Complete",
  })[status] || title(status);
}

function title(value) {
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function option(value, text) {
  return el("option", "", text, { value });
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function el(tag, className = "", text = "", attributes = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, value));
  return node;
}

function clearNotice() {
  ui.notice.hidden = true;
  ui.notice.textContent = "";
}

function clearInlineError() {
  ui.reviewError.hidden = true;
  ui.reviewError.textContent = "";
}

function showInlineError(message) {
  ui.reviewError.textContent = message;
  ui.reviewError.hidden = false;
  ui.reviewError.focus?.();
}

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 3200);
}
