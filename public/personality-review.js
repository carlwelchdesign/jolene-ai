const state = { scope: {}, snapshot: null, reviewStatus: "unavailable" };
const ui = Object.fromEntries([
  "scope-chip", "refresh-button", "page-notice", "summary-sources",
  "summary-observations", "summary-reviewed", "summary-decision", "snapshot-meta",
  "research-state", "decision-panel", "decision-form", "decision", "feedback",
  "review-error", "review-submit", "toast",
].map((id) => [id.replaceAll("-", ""), document.getElementById(id)]));

ui.refreshbutton.addEventListener("click", load);
ui.decision.addEventListener("change", validateForm);
ui.feedback.addEventListener("input", validateForm);
ui.decisionform.addEventListener("submit", submitDecision);
load();

async function load() {
  setLoading(); clearNotice();
  try {
    state.scope = await api("/v1/personality-research-review/scope");
    ui.scopechip.replaceChildren(el("span", "", "●", { "aria-hidden": "true" }), document.createTextNode(` ${state.scope.actorId} · ${state.scope.workspaceId}`));
    const result = await api(`/v1/personality-research-review?${new URLSearchParams(state.scope)}`);
    state.snapshot = result.snapshot; state.reviewStatus = result.reviewStatus;
    render(result);
  } catch (error) { renderError(friendlyError(error)); }
}

function render(result) {
  const s = result.snapshot;
  ui.summarysources.textContent = String(s.registeredSources);
  ui.summaryobservations.textContent = String(s.observations);
  ui.summaryreviewed.textContent = `${s.independentlyReviewed} / ${s.observations}`;
  ui.summarydecision.textContent = reviewLabel(result.reviewStatus, result.decision);
  ui.snapshotmeta.replaceChildren(
    term("Snapshot", s.snapshotHash), term("Research reviewed", formatDate(s.reviewedAt)),
    term("Storage", s.rightsPolicy.repositoryStorage), term("Runtime", "Unchanged"),
  );
  const stack = el("div", "research-stack");
  stack.append(section("Source register", renderSources(s.sources)));
  stack.append(section("Coded observations", renderObservations(s.codedObservations)));
  stack.append(section("Pilot hypotheses", artifact(s.hypothesesMarkdown)));
  stack.append(section("Rejected patterns and contradictions", artifact(s.rejectionLogMarkdown)));
  stack.append(section("Artifact fingerprints", renderArtifacts(s.artifacts)));
  ui.researchstate.replaceChildren(stack); ui.researchstate.setAttribute("aria-busy", "false");
  ui.decisionpanel.hidden = result.reviewStatus === "complete";
  if (result.reviewStatus === "stale") showNotice("The research files changed after the saved decision. Review this new snapshot before relying on the earlier decision.");
  if (result.reviewStatus === "decision_malformed") showNotice("The saved decision is invalid and is not treated as approval.");
  if (result.reviewStatus === "complete") showNotice(`This exact snapshot was marked ${title(result.decision.decision)} on ${formatDate(result.decision.reviewedAt)}. Runtime personality remains unchanged.`);
  validateForm();
}

function renderSources(sources) {
  const grid = el("div", "source-grid");
  for (const source of sources) {
    const card = el("article", "source-card");
    card.append(el("h4", "", `${source.id} · ${source.title}`), el("p", "", `${source.publisher} · ${source.date} · ${title(source.setting)}`), el("p", "", source.research_value));
    const link = el("a", "", "Open primary source", { href: source.url, target: "_blank", rel: "noreferrer" });
    card.append(link); grid.append(card);
  }
  return grid;
}

function renderObservations(observations) {
  const list = el("div", "observation-list");
  for (const item of observations) {
    const details = el("details", "observation-card");
    details.append(el("summary", "", `${item.observation_id} · ${title(item.candidate_trait)}`));
    details.append(el("p", "", item.paraphrase), el("p", "", `Possible adaptation: ${item.jolene_adaptation}`), el("p", "", `Alternative reading: ${item.alternative_interpretation}`), el("p", "", `Do not copy: ${item.do_not_copy}`));
    const tags = el("div", "tag-row");
    [item.source_id, item.observation_evidence_class, item.candidate_trait_evidence_class, item.adaptation_evidence_class, item.review_status].forEach((value) => tags.append(el("span", "tag", title(value))));
    details.append(tags); list.append(details);
  }
  return list;
}

function renderArtifacts(items) {
  const list = el("dl", "snapshot-meta");
  for (const item of items) list.append(term(item.name, item.sha256));
  return list;
}
function artifact(text) { return el("pre", "plain-artifact", text); }
function section(titleText, content) { const node = el("section", "research-section"); node.append(el("h3", "", titleText), content); return node; }
function term(label, value) { const f = document.createDocumentFragment(); f.append(el("dt", "", label), el("dd", "", value)); return f; }

function validateForm() {
  const decision = ui.decision.value; const feedback = ui.feedback.value.trim();
  ui.reviewsubmit.disabled = !state.snapshot || !decision || (decision !== "approved" && !feedback);
}

async function submitDecision(event) {
  event.preventDefault(); clearError(); ui.reviewsubmit.disabled = true;
  try {
    await api("/v1/personality-research-review/decision", { method: "POST", body: { ...state.scope, snapshotHash: state.snapshot.snapshotHash, decision: ui.decision.value, feedback: ui.feedback.value.trim() } });
    showToast("Relevance decision saved for this exact snapshot."); await load();
  } catch (error) { showError(friendlyError(error)); validateForm(); }
}

async function api(path, options = {}) {
  const response = await fetch(path, { method: options.method || "GET", headers: options.body ? { "content-type": "application/json" } : undefined, body: options.body ? JSON.stringify(options.body) : undefined });
  let body; try { body = await response.json(); } catch { body = null; }
  if (!response.ok) { const error = new Error(body?.error || "request_failed"); error.status = response.status; throw error; }
  return body;
}
function friendlyError(error) {
  if (error?.message === "personality_review_scope_not_permitted") return "This research review is available only in Carl’s configured owner scope.";
  if (error?.message === "personality_review_conflict") return "The research changed or already has a different decision. Refresh before deciding.";
  if (error?.message === "invalid_request") return "Choose a decision and provide feedback when requesting changes or rejecting the snapshot.";
  return "Jolene’s local personality research service is unavailable. Check the private service, then retry.";
}
function setLoading() { ui.researchstate.setAttribute("aria-busy", "true"); ui.researchstate.replaceChildren(el("div", "loading-state", "Loading the owner-only research snapshot…")); ui.decisionpanel.hidden = true; }
function renderError(message) { ui.researchstate.setAttribute("aria-busy", "false"); ui.researchstate.replaceChildren(el("div", "empty-state", message)); ui.summarydecision.textContent = "Unavailable"; }
function reviewLabel(status, decision) { return status === "complete" ? title(decision.decision) : ({ unreviewed: "Required", stale: "Stale", decision_malformed: "Invalid" })[status] || "Unavailable"; }
function title(value) { return String(value).replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: value.includes("T") ? "short" : undefined }).format(date); }
function el(tag, className = "", text = "", attributes = {}) { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, value)); return node; }
function clearNotice() { ui.pagenotice.hidden = true; ui.pagenotice.textContent = ""; }
function showNotice(message) { ui.pagenotice.textContent = message; ui.pagenotice.hidden = false; }
function clearError() { ui.reviewerror.hidden = true; ui.reviewerror.textContent = ""; }
function showError(message) { ui.reviewerror.textContent = message; ui.reviewerror.hidden = false; ui.reviewerror.focus(); }
let toastTimer; function showToast(message) { clearTimeout(toastTimer); ui.toast.textContent = message; ui.toast.hidden = false; toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 3500); }
