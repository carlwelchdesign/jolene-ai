const dimensions = [
  ["taskSuccess", "Task success"], ["evidenceTransparency", "Evidence transparency"],
  ["warmthKindness", "Warmth and kindness"], ["witRestraint", "Wit and restraint"],
  ["agencyBoundaries", "Agency boundaries"], ["situationalCalibration", "Situational calibration"],
  ["originality", "Originality"],
];
const hardFailures = [
  "canned_pr_language", "empty_evidence_rendering", "fabricated_biography_or_quotation",
  "private_disclosure", "personality_displaces_substance", "factual_or_citation_drift",
  "high_stakes_personality_not_suppressed", "conversation_continuity_lost",
];
const state = { scope: null, snapshot: null };
const ui = Object.fromEntries([
  "scope-chip", "page-notice", "refresh-button", "summary-packet", "summary-cases",
  "summary-preflight", "summary-review", "packet-meta", "packet-state", "decision-panel",
  "review-form", "case-reviews", "overall-decision", "decision-guidance", "review-error",
  "review-submit", "toast",
].map((id) => [id.replaceAll("-", "_"), document.querySelector(`#${id}`)]));

ui.refresh_button.addEventListener("click", refresh);
ui.review_form.addEventListener("submit", saveReview);
ui.review_form.addEventListener("input", updateSubmitState);
refresh();

async function refresh() {
  ui.refresh_button.disabled = true;
  clearNotice();
  ui.packet_state.setAttribute("aria-busy", "true");
  ui.packet_state.replaceChildren(el("div", "loading-state", "Loading the private capture packet…"));
  try {
    state.scope = await api("/v1/conversation-quality-review/scope");
    ui.scope_chip.replaceChildren(el("span", "", "●", { "aria-hidden": "true" }), document.createTextNode(`${state.scope.actorId} · ${state.scope.workspaceId}`));
    state.snapshot = await api(`/v1/conversation-quality-review${scopeQuery()}`);
    renderSnapshot();
  } catch (error) {
    ui.packet_state.replaceChildren(el("div", "error-state", friendlyError(error)));
    showNotice(friendlyError(error));
  } finally { ui.refresh_button.disabled = false; }
}

function renderSnapshot() {
  const { packetStatus, reviewStatus, packet, decision, criteria } = state.snapshot;
  ui.summary_packet.textContent = title(packetStatus);
  ui.summary_cases.textContent = packet ? String(packet.cases.length) : "—";
  ui.summary_preflight.textContent = packet ? "Passed" : "—";
  ui.summary_review.textContent = title(reviewStatus);
  ui.packet_meta.replaceChildren();
  ui.packet_state.setAttribute("aria-busy", "false");
  ui.decision_panel.hidden = true;
  if (!packet) {
    const copy = packetStatus === "malformed"
      ? "The capture failed schema validation and cannot be reviewed."
      : "No owner-only capture exists at the configured path yet.";
    ui.packet_state.replaceChildren(el("div", packetStatus === "malformed" ? "error-state" : "empty-state", copy));
    return;
  }
  [["Suite", packet.suiteId], ["Model", packet.model], ["Captured", formatDate(packet.capturedAt)], ["Packet hash", state.snapshot.packetHash]]
    .forEach(([label, value]) => ui.packet_meta.append(el("dt", "", label), el("dd", "", value)));
  const criteriaById = new Map(criteria.map((item) => [item.id, item]));
  const stack = el("div", "case-stack");
  packet.cases.forEach((item, index) => stack.append(caseCard(item, index, criteriaById.get(item.id))));
  ui.packet_state.replaceChildren(stack);
  renderDecisionForm(packet, reviewStatus, decision);
}

function caseCard(item, index, criteria) {
  const card = el("article", "quality-case");
  const header = el("div", "case-header");
  const heading = el("div");
  heading.append(el("p", "eyebrow", `Case ${index + 1} · ${title(item.category)} · ${title(item.channel)}`), el("h3", "", item.prompt));
  header.append(heading, el("span", "case-mode", item.mode));
  card.append(header, block("Exact answer", item.answer));
  const expectations = el("div", "capture-block");
  expectations.append(el("strong", "", `Expected behavior${criteria?.requiresEvidence ? " · evidence required" : ""}`));
  const expectedList = el("ul", "criteria-list");
  (criteria?.expectedBehaviors || []).forEach((value) => expectedList.append(el("li", "", value)));
  expectations.append(expectedList);
  card.append(expectations);
  const citations = el("div", "capture-block");
  citations.append(el("strong", "", `Citations · ${item.citations.length}`));
  if (item.citations.length) {
    const list = el("ol", "citation-list"); item.citations.forEach((citation) => list.append(el("li", "", `${citation.label} (${citation.id})`))); citations.append(list);
  } else citations.append(el("p", "", "No citations returned."));
  card.append(citations);
  if (item.followUps.length) {
    const follow = el("div", "capture-block"); follow.append(el("strong", "", "Suggested follow-ups"));
    const list = el("ul", "follow-up-list"); item.followUps.forEach((value) => list.append(el("li", "", value))); follow.append(list); card.append(follow);
  }
  return card;
}

function block(label, value) { const node = el("div", "capture-block"); node.append(el("strong", "", label), document.createTextNode(value)); return node; }

function renderDecisionForm(packet, reviewStatus, decision) {
  ui.decision_panel.hidden = false; ui.case_reviews.replaceChildren(); ui.review_form.reset(); ui.review_error.hidden = true;
  if (["stale", "decision_malformed"].includes(reviewStatus)) {
    ui.case_reviews.append(el("div", "historical-decision", reviewStatus === "stale" ? "The saved decision belongs to an older packet. Score this capture again." : "The saved decision is malformed and does not count."));
  }
  const prefill = reviewStatus === "complete" ? decision : null;
  packet.cases.forEach((item, index) => ui.case_reviews.append(reviewFields(item, index, prefill?.reviews.find((review) => review.caseId === item.id))));
  if (prefill) ui.overall_decision.value = prefill.overall;
  updateSubmitState();
}

function reviewFields(item, index, existing) {
  const fieldset = el("fieldset", "case-review", "", { "data-case-id": item.id });
  fieldset.append(el("legend", "", `Case ${index + 1} · ${title(item.category)}`));
  const ratings = el("div", "rating-grid");
  dimensions.forEach(([key, labelText]) => {
    const id = `quality-${index}-${key}`; const label = el("label", "", "", { for: id });
    const select = el("select", "", "", { id, required: "", "data-score": key });
    select.append(option("", "Choose 0–4")); for (let value = 0; value <= 4; value += 1) select.append(option(String(value), `${value} · ${scoreLabel(value)}`));
    if (existing) select.value = String(existing.scores[key]); label.append(document.createTextNode(labelText), select); ratings.append(label);
  });
  fieldset.append(ratings);
  const failures = el("div", "failure-group"); failures.append(el("strong", "", "Hard failures observed"));
  const failureGrid = el("div", "failure-grid");
  hardFailures.forEach((code) => { const label = el("label"); const checkbox = el("input", "", "", { type: "checkbox", value: code, "data-hard-failure": "true" }); checkbox.checked = existing?.reviewerHardFailures.includes(code) || false; label.append(checkbox, document.createTextNode(title(code))); failureGrid.append(label); });
  failures.append(failureGrid); fieldset.append(failures);
  const notesLabel = el("label", "review-notes"); const notes = el("textarea", "", "", { maxlength: "2000", "data-notes": "true" }); notes.value = existing?.notes || ""; notesLabel.append(document.createTextNode("Reviewer notes (optional)"), notes); fieldset.append(notesLabel);
  return fieldset;
}

async function saveReview(event) {
  event.preventDefault(); if (!formComplete()) return; ui.review_submit.disabled = true; ui.review_error.hidden = true;
  try {
    const reviews = [...ui.case_reviews.querySelectorAll("[data-case-id]")].map((container) => ({
      caseId: container.dataset.caseId,
      answer: state.snapshot.packet.cases.find((item) => item.id === container.dataset.caseId).answer,
      citations: state.snapshot.packet.cases.find((item) => item.id === container.dataset.caseId).citations,
      followUps: state.snapshot.packet.cases.find((item) => item.id === container.dataset.caseId).followUps,
      scores: Object.fromEntries(dimensions.map(([key]) => [key, Number(container.querySelector(`[data-score="${key}"]`).value)])),
      reviewerHardFailures: [...container.querySelectorAll("[data-hard-failure]:checked")].map((input) => input.value),
      notes: container.querySelector("[data-notes]").value.trim(),
    }));
    await api("/v1/conversation-quality-review/decision", { method: "POST", body: { ...state.scope, packetHash: state.snapshot.packetHash, overall: ui.overall_decision.value, reviews } });
    showToast("Human review saved for this exact capture."); await refresh();
  } catch (error) { ui.review_error.textContent = friendlyError(error); ui.review_error.hidden = false; }
  finally { updateSubmitState(); }
}

function updateSubmitState() { ui.review_submit.disabled = !formComplete(); }
function formComplete() { const scores = [...ui.case_reviews.querySelectorAll("[data-score]")]; return scores.length > 0 && scores.every((control) => control.value !== "") && Boolean(ui.overall_decision.value); }
function scopeQuery() { return `?actorId=${encodeURIComponent(state.scope.actorId)}&workspaceId=${encodeURIComponent(state.scope.workspaceId)}`; }
async function api(url, options = {}) { const response = await fetch(url, { method: options.method || "GET", headers: options.body ? { "content-type": "application/json" } : undefined, body: options.body ? JSON.stringify(options.body) : undefined }); const body = await response.json(); if (!response.ok) { const error = new Error(body.error || "request_failed"); error.code = body.error; throw error; } return body; }
function el(tag, className = "", content = "", attributes = {}) { const node = document.createElement(tag); if (className) node.className = className; Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value)); if (content) node.textContent = content; return node; }
function option(value, label) { const node = el("option", "", label); node.value = value; return node; }
function title(value) { return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function scoreLabel(value) { return ["Unacceptable", "Weak", "Mixed", "Good", "Excellent"][value]; }
function formatDate(value) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function friendlyError(error) { const messages = { conversation_quality_scope_not_permitted: "This review is restricted to Carl’s owner scope.", conversation_quality_review_unavailable: "The private capture packet is unavailable.", conversation_quality_review_conflict: "The packet changed or the decision does not match the calculated gate. Refresh and review again.", request_origin_not_permitted: "The save request was rejected because it did not originate from this local app." }; return messages[error?.code] || "The conversation review could not be loaded or saved."; }
function showNotice(message) { ui.page_notice.textContent = message; ui.page_notice.hidden = false; }
function clearNotice() { ui.page_notice.hidden = true; ui.page_notice.textContent = ""; }
function showToast(message) { ui.toast.textContent = message; ui.toast.hidden = false; window.setTimeout(() => { ui.toast.hidden = true; }, 3500); }
