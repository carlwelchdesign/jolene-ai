const state = {
  scope: null,
  sources: [],
  claims: [],
  issues: [],
  filter: "needs_review",
  query: "",
  pendingDecision: null,
};

const ui = {
  scopeChip: document.querySelector("#scope-chip"),
  notice: document.querySelector("#page-notice"),
  list: document.querySelector("#evidence-list"),
  search: document.querySelector("#search"),
  sourceCount: document.querySelector("#count-sources"),
  reviewCount: document.querySelector("#count-review"),
  internalCount: document.querySelector("#count-internal"),
  publicCount: document.querySelector("#count-public"),
  decisionDialog: document.querySelector("#decision-dialog"),
  decisionForm: document.querySelector("#decision-form"),
  decisionEyebrow: document.querySelector("#decision-eyebrow"),
  decisionTitle: document.querySelector("#decision-title"),
  decisionCopy: document.querySelector("#decision-copy"),
  decisionEvidence: document.querySelector("#decision-evidence"),
  publicConfirmation: document.querySelector("#public-confirmation"),
  publicConfirm: document.querySelector("#public-confirm"),
  decisionError: document.querySelector("#decision-error"),
  decisionSubmit: document.querySelector("#decision-submit"),
  toast: document.querySelector("#toast"),
};

initialize();

function initialize() {
  document.querySelector("#refresh-button").addEventListener("click", refresh);
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      document.querySelectorAll("[data-filter]").forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle("is-active", active);
        candidate.setAttribute("aria-pressed", String(active));
      });
      render();
    });
  });
  ui.search.addEventListener("input", () => {
    state.query = ui.search.value.trim().toLowerCase();
    render();
  });
  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => ui.decisionDialog.close());
  });
  ui.decisionDialog.addEventListener("click", (event) => {
    if (event.target === ui.decisionDialog) ui.decisionDialog.close();
  });
  ui.decisionForm.addEventListener("submit", submitConfirmedDecision);
  refresh();
}

async function refresh() {
  clearNotice();
  ui.list.setAttribute("aria-busy", "true");
  ui.list.replaceChildren(el("div", "loading-state", "Loading career evidence…"));
  try {
    state.scope = await api("/v1/career-evidence/scope");
    ui.scopeChip.replaceChildren(el("span", "", "●"), document.createTextNode(`${state.scope.actorId} · ${state.scope.workspaceId}`));
    const query = `?actorId=${encodeURIComponent(state.scope.actorId)}&workspaceId=${encodeURIComponent(state.scope.workspaceId)}`;
    [state.sources, state.claims, state.issues] = await Promise.all([
      api("/v1/career-evidence/sources" + query),
      api("/v1/career-evidence/claims" + query),
      api("/v1/career-evidence/validation" + query),
    ]);
    render();
  } catch (error) {
    ui.list.setAttribute("aria-busy", "false");
    ui.list.replaceChildren(errorState(friendlyError(error)));
    showNotice(friendlyError(error), true);
  }
}

function render() {
  ui.list.setAttribute("aria-busy", "false");
  updateSummary();
  const visibleSources = state.sources.filter((source) => sourceMatches(source));
  ui.list.replaceChildren();
  if (visibleSources.length === 0) {
    ui.list.append(emptyState(
      state.query ? "No matching evidence" : "Nothing in this view",
      state.query ? "Try a broader search or choose another status." : "Choose another filter to inspect the full evidence registry.",
    ));
    return;
  }
  visibleSources.forEach((source) => ui.list.append(renderSource(source)));
}

function updateSummary() {
  ui.sourceCount.textContent = String(state.sources.filter((source) => source.state === "active").length);
  ui.reviewCount.textContent = String(state.claims.filter((claim) => claim.state === "active" && claim.reviewState === "needs_review").length);
  ui.internalCount.textContent = String(state.claims.filter((claim) => claim.state === "active" && claim.visibility === "internal_approved").length);
  ui.publicCount.textContent = String(state.claims.filter((claim) => claim.state === "active" && claim.visibility === "public_approved").length);
}

function sourceMatches(source) {
  const claims = claimsForSource(source.id);
  const searchable = [source.title, source.sourceType, source.provenanceRef, source.provenanceUri, ...claims.flatMap((claim) => [claim.title, claim.proposition, claim.contribution, claim.maturity])]
    .filter(Boolean).join(" ").toLowerCase();
  if (state.query && !searchable.includes(state.query)) return false;
  if (state.filter === "all") return true;
  if (state.filter === "needs_review") return source.reviewState === "needs_review" || claims.some((claim) => claim.state === "active" && claim.reviewState === "needs_review");
  if (state.filter === "internal_approved") return claims.some((claim) => claim.state === "active" && claim.visibility === "internal_approved");
  if (state.filter === "public_approved") return claims.some((claim) => claim.state === "active" && claim.visibility === "public_approved");
  return source.state !== "active" || source.reviewState === "rejected" || claims.some((claim) => claim.state !== "active" || claim.reviewState === "rejected");
}

function renderSource(source) {
  const card = el("article", `source-card is-${source.state}`);
  const header = el("div", "source-header");
  const details = el("div");
  const badges = el("div", "badge-row");
  badges.append(badge(humanize(source.sourceType)), badge(humanize(source.reviewState), badgeClass(source.reviewState)), badge(humanize(source.state), badgeClass(source.state)));
  details.append(badges, el("h3", "source-title", source.title));
  const provenance = el("p", "source-provenance");
  provenance.append(document.createTextNode("Evidence: "));
  if (safePublicUrl(source.provenanceUri)) {
    const link = document.createElement("a");
    link.href = source.provenanceUri;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = source.provenanceUri;
    provenance.append(link);
  } else {
    provenance.append(document.createTextNode(source.provenanceRef || "No provenance recorded"));
  }
  details.append(provenance);
  const sourceIssues = issuesFor("source", source.id);
  if (sourceIssues.length) {
    const list = el("ul", "issue-list");
    sourceIssues.forEach((issue) => list.append(el("li", "", issue.message)));
    details.append(list);
  }

  const actions = el("div", "source-actions");
  if (source.state === "active") {
    if (source.reviewState !== "approved") actions.append(actionButton("Approve source", "button button-primary button-small", () => decideSource(source, "approved")));
    if (source.reviewState !== "rejected") actions.append(actionButton("Reject source", "button button-secondary button-small", () => decideSource(source, "rejected")));
    actions.append(actionButton("Revoke source", "button button-quiet button-small", () => openConfirmation({ kind: "source_revoke", source })));
  }
  header.append(details, actions);
  card.append(header);

  const claims = claimsForSource(source.id);
  const disclosure = document.createElement("details");
  disclosure.className = "claim-disclosure";
  disclosure.open = Boolean(state.query);
  const summary = document.createElement("summary");
  const pendingCount = claims.filter((claim) => claim.state === "active" && claim.reviewState === "needs_review").length;
  summary.append(
    el("span", "claim-summary-title", claims.length === 1 ? "Review 1 claim" : `Review ${claims.length} claims`),
    el("span", "claim-summary-meta", pendingCount === 0 ? "No claims waiting" : `${pendingCount} waiting`),
  );
  const claimList = el("div", "claim-list");
  if (claims.length === 0) claimList.append(emptyState("No claims from this source", "The source is registered, but it has no extracted career claims."));
  claims.forEach((claim) => claimList.append(renderClaim(claim, source)));
  disclosure.append(summary, claimList);
  card.append(disclosure);
  return card;
}

function renderClaim(claim, source) {
  const card = el("section", `claim-card${claim.state === "active" ? "" : " is-retired"}`);
  card.setAttribute("aria-label", claim.title);
  const details = el("div");
  const badges = el("div", "badge-row");
  badges.append(badge(humanize(claim.maturity)), badge(humanize(claim.visibility), badgeClass(claim.visibility)), badge(humanize(claim.reviewState), badgeClass(claim.reviewState)), badge(humanize(claim.state), badgeClass(claim.state)));
  details.append(badges, el("h4", "claim-title", claim.title), el("p", "claim-proposition", claim.proposition), el("p", "claim-contribution", claim.contribution));
  const actions = el("div", "claim-actions");
  if (claim.state === "active") {
    const sourceApproved = source.reviewState === "approved" && source.state === "active";
    const internal = actionButton("Approve internal", "button button-primary button-small", () => decideClaim(claim, "approve_internal"));
    const publicButton = actionButton("Review for public", "button button-public button-small", () => openConfirmation({ kind: "claim_public", claim, source }));
    internal.disabled = !sourceApproved;
    publicButton.disabled = !sourceApproved || !source.provenanceUri;
    if (claim.visibility !== "internal_approved") actions.append(internal);
    if (claim.visibility !== "public_approved") actions.append(publicButton);
    if (claim.reviewState !== "rejected") actions.append(actionButton("Reject", "button button-secondary button-small", () => decideClaim(claim, "reject")));
    actions.append(actionButton("Revoke", "button button-quiet button-small", () => openConfirmation({ kind: "claim_revoke", claim, source })));
  }
  card.append(details, actions);
  if (claim.state === "active" && source.reviewState !== "approved") card.append(el("p", "claim-policy", "Approve this source before approving its claims."));
  else if (claim.state === "active" && !source.provenanceUri && claim.visibility !== "public_approved") card.append(el("p", "claim-policy", "Public approval is unavailable because this source has no public citation URL."));
  const issues = issuesFor("claim", claim.id);
  if (issues.length) {
    const list = el("ul", "issue-list");
    issues.forEach((issue) => list.append(el("li", "", issue.message)));
    card.append(list);
  }
  return card;
}

function openConfirmation(decision) {
  state.pendingDecision = decision;
  ui.decisionError.hidden = true;
  ui.publicConfirm.checked = false;
  ui.decisionEvidence.replaceChildren();
  const isPublic = decision.kind === "claim_public";
  ui.publicConfirmation.hidden = !isPublic;
  ui.decisionEyebrow.textContent = isPublic ? "Public eligibility" : "Destructive evidence decision";
  ui.decisionTitle.textContent = isPublic ? "Approve this exact public claim?" : decision.kind === "source_revoke" ? "Revoke this source?" : "Revoke this claim?";
  ui.decisionCopy.textContent = isPublic
    ? "This makes the exact claim eligible for recruiter-facing retrieval. It does not publish, send, or edit anything."
    : "Revocation removes this evidence from eligible retrieval. The audit record remains.";
  const record = decision.claim || decision.source;
  ui.decisionEvidence.append(el("strong", "", record.proposition || record.title));
  const citation = decision.source?.provenanceUri || decision.source?.provenanceRef;
  if (citation) ui.decisionEvidence.append(el("span", "", "Evidence: " + citation));
  ui.decisionSubmit.textContent = isPublic ? "Approve for public answers" : "Revoke evidence";
  ui.decisionSubmit.className = isPublic ? "button button-primary" : "button button-danger";
  ui.decisionDialog.showModal();
  if (isPublic) ui.publicConfirm.focus(); else ui.decisionSubmit.focus();
}

async function submitConfirmedDecision(event) {
  event.preventDefault();
  if (!state.pendingDecision) return;
  if (state.pendingDecision.kind === "claim_public" && !ui.publicConfirm.checked) {
    showInlineError("Confirm the exact recruiter-facing claim before approval.");
    return;
  }
  ui.decisionSubmit.disabled = true;
  try {
    if (state.pendingDecision.kind === "claim_public") await decideClaim(state.pendingDecision.claim, "approve_public", false);
    if (state.pendingDecision.kind === "claim_revoke") await mutate(`/v1/career-evidence/claims/${encodeURIComponent(state.pendingDecision.claim.id)}/revoke`, {});
    if (state.pendingDecision.kind === "source_revoke") await mutate(`/v1/career-evidence/sources/${encodeURIComponent(state.pendingDecision.source.id)}/revoke`, {});
    ui.decisionDialog.close();
    showToast(state.pendingDecision.kind === "claim_public" ? "Claim approved for public answers." : "Evidence revoked.");
    await refresh();
  } catch (error) {
    showInlineError(friendlyError(error));
  } finally {
    ui.decisionSubmit.disabled = false;
  }
}

async function decideSource(source, decision) {
  try {
    await mutate(`/v1/career-evidence/sources/${encodeURIComponent(source.id)}/decision`, { decision, reviewerId: state.scope.actorId });
    showToast(decision === "approved" ? "Source approved." : "Source rejected.");
    await refresh();
  } catch (error) { showNotice(friendlyError(error), true); }
}

async function decideClaim(claim, decision, shouldRefresh = true) {
  await mutate(`/v1/career-evidence/claims/${encodeURIComponent(claim.id)}/decision`, { decision, reviewerId: state.scope.actorId });
  if (shouldRefresh) {
    showToast(decision === "approve_internal" ? "Claim approved for Jolene's private answers." : "Claim rejected.");
    await refresh();
  }
}

async function mutate(path, body) {
  return api(path, { method: "POST", body: { ...state.scope, ...body } });
}

function claimsForSource(sourceId) { return state.claims.filter((claim) => claim.sourceId === sourceId); }
function issuesFor(kind, id) { return state.issues.filter((issue) => issue.recordKind === kind && issue.recordId === id); }

async function api(path, options = {}) {
  const response = await fetch(path, { method: options.method || "GET", headers: options.body ? { "content-type": "application/json" } : undefined, body: options.body ? JSON.stringify(options.body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "request_failed");
    error.status = response.status;
    error.issues = payload.issues;
    throw error;
  }
  return payload;
}

function friendlyError(error) {
  if (error.message === "career_scope_not_permitted") return "This browser is not permitted to review the configured career evidence scope.";
  if (error.message === "career_evidence_approval_blocked") return error.issues?.map((issue) => issue.message).join(" ") || "Policy checks blocked this approval.";
  if (error.message === "career_evidence_conflict") return "This evidence changed or is no longer active. Refresh before deciding.";
  if (error.status === 404) return "This evidence record no longer exists in the owner scope.";
  return "Career evidence could not be updated. Check that Jolene is running, then retry.";
}

function actionButton(label, className, handler) { const element = el("button", className, label); element.type = "button"; element.addEventListener("click", handler); return element; }
function badge(label, extra = "") { return el("span", `badge ${extra}`.trim(), label); }
function badgeClass(value) { return ["approved", "internal_approved", "public_approved", "active"].includes(value) ? "badge-active" : ["rejected", "revoked"].includes(value) ? "badge-sensitive" : ["missing", "superseded"].includes(value) ? "badge-superseded" : ""; }
function humanize(value) { return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function safePublicUrl(value) { if (value?.startsWith("/") && !value.startsWith("//")) return true; try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } }
function emptyState(title, copy) { const container = el("div", "empty-state"); container.append(el("strong", "", title), el("p", "", copy)); return container; }
function errorState(copy) { const container = el("div", "error-state"); container.append(el("strong", "", "Evidence unavailable"), el("p", "", copy)); return container; }
function el(tag, className = "", text = "") { const element = document.createElement(tag); if (className) element.className = className; if (text) element.textContent = text; return element; }
function showNotice(message, isError = false) { ui.notice.textContent = message; ui.notice.classList.toggle("is-error", isError); ui.notice.hidden = false; }
function clearNotice() { ui.notice.hidden = true; ui.notice.textContent = ""; }
function showInlineError(message) { ui.decisionError.textContent = message; ui.decisionError.hidden = false; }
function showToast(message) { ui.toast.textContent = message; ui.toast.hidden = false; window.clearTimeout(showToast.timer); showToast.timer = window.setTimeout(() => { ui.toast.hidden = true; }, 3200); }
