const state = {
  scope: null,
  sources: [],
  claims: [],
  conflicts: [],
  issues: [],
  selectedClaimIds: new Set(),
  expandedSourceIds: new Set(),
  filter: "needs_review",
  query: "",
  page: 1,
  pageSize: 10,
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
  conflictCount: document.querySelector("#count-conflicts"),
  conflictList: document.querySelector("#conflict-list"),
  selectionStatus: document.querySelector("#selection-status"),
  selectionHelp: document.querySelector("#selection-help"),
  clearSelection: document.querySelector("#clear-selection"),
  reviewConflict: document.querySelector("#review-conflict"),
  pageStatus: document.querySelector("#evidence-page-status"),
  previousPage: document.querySelector("#previous-evidence-page"),
  nextPage: document.querySelector("#next-evidence-page"),
  pageStatusFooter: document.querySelector("#evidence-page-status-footer"),
  previousPageFooter: document.querySelector("#previous-evidence-page-footer"),
  nextPageFooter: document.querySelector("#next-evidence-page-footer"),
  decisionDialog: document.querySelector("#decision-dialog"),
  decisionForm: document.querySelector("#decision-form"),
  decisionEyebrow: document.querySelector("#decision-eyebrow"),
  decisionTitle: document.querySelector("#decision-title"),
  decisionCopy: document.querySelector("#decision-copy"),
  decisionEvidence: document.querySelector("#decision-evidence"),
  publicConfirmation: document.querySelector("#public-confirmation"),
  publicConfirm: document.querySelector("#public-confirm"),
  conflictConfirmation: document.querySelector("#conflict-confirmation"),
  conflictConfirm: document.querySelector("#conflict-confirm"),
  decisionError: document.querySelector("#decision-error"),
  decisionSubmit: document.querySelector("#decision-submit"),
  toast: document.querySelector("#toast"),
};

initialize();

function initialize() {
  document.querySelector("#refresh-button").addEventListener("click", refresh);
  ui.clearSelection.addEventListener("click", () => {
    state.selectedClaimIds.clear();
    render();
  });
  ui.reviewConflict.addEventListener("click", () => openConfirmation({
    kind: "conflict_declare",
    claims: selectedClaims(),
  }));
  ui.previousPage.addEventListener("click", () => changeEvidencePage(-1, ui.pageStatus));
  ui.nextPage.addEventListener("click", () => changeEvidencePage(1, ui.pageStatus));
  ui.previousPageFooter.addEventListener("click", () => changeEvidencePage(-1, ui.pageStatusFooter));
  ui.nextPageFooter.addEventListener("click", () => changeEvidencePage(1, ui.pageStatusFooter));
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      state.page = 1;
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
    state.page = 1;
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
  ui.conflictList.setAttribute("aria-busy", "true");
  ui.list.replaceChildren(el("div", "loading-state", "Loading career evidence…"));
  ui.conflictList.replaceChildren(el("div", "loading-state", "Loading claim conflicts…"));
  try {
    state.scope = await api("/v1/career-evidence/scope");
    ui.scopeChip.replaceChildren(el("span", "", "●"), document.createTextNode(`${state.scope.actorId} · ${state.scope.workspaceId}`));
    const query = `?actorId=${encodeURIComponent(state.scope.actorId)}&workspaceId=${encodeURIComponent(state.scope.workspaceId)}`;
    [state.sources, state.claims, state.conflicts, state.issues] = await Promise.all([
      api("/v1/career-evidence/sources" + query),
      api("/v1/career-evidence/claims" + query),
      api("/v1/career-evidence/conflicts" + query),
      api("/v1/career-evidence/validation" + query),
    ]);
    const selectableIds = new Set(state.claims
      .filter((claim) => claim.state === "active" && !unresolvedConflictFor(claim.id))
      .map((claim) => claim.id));
    state.selectedClaimIds.forEach((claimId) => {
      if (!selectableIds.has(claimId)) state.selectedClaimIds.delete(claimId);
    });
    render();
  } catch (error) {
    ui.list.setAttribute("aria-busy", "false");
    ui.conflictList.setAttribute("aria-busy", "false");
    ui.list.replaceChildren(errorState(friendlyError(error)));
    ui.conflictList.replaceChildren(errorState(friendlyError(error)));
    showNotice(friendlyError(error), true);
  }
}

function render() {
  ui.list.setAttribute("aria-busy", "false");
  ui.conflictList.setAttribute("aria-busy", "false");
  updateSummary();
  renderConflictReview();
  const visibleSources = state.sources.filter((source) => sourceMatches(source));
  const totalPages = Math.max(1, Math.ceil(visibleSources.length / state.pageSize));
  state.page = Math.min(Math.max(state.page, 1), totalPages);
  const start = (state.page - 1) * state.pageSize;
  const pageSources = visibleSources.slice(start, start + state.pageSize);
  renderPagination(visibleSources.length, totalPages, start, pageSources.length);
  ui.list.replaceChildren();
  if (visibleSources.length === 0) {
    ui.list.append(emptyState(
      state.query ? "No matching evidence" : "Nothing in this view",
      state.query ? "Try a broader search or choose another status." : "Choose another filter to inspect the full evidence registry.",
    ));
    return;
  }
  pageSources.forEach((source) => ui.list.append(renderSource(source)));
}

function renderPagination(totalResults, totalPages, start, pageCount) {
  let status;
  if (totalResults === 0) {
    status = "0 matching sources";
  } else {
    const first = start + 1;
    const last = start + pageCount;
    status = `Showing ${first}–${last} of ${totalResults} sources · Page ${state.page} of ${totalPages}`;
  }
  ui.pageStatus.textContent = status;
  ui.pageStatusFooter.textContent = status;
  [ui.previousPage, ui.previousPageFooter].forEach((button) => {
    button.disabled = totalResults === 0 || state.page <= 1;
  });
  [ui.nextPage, ui.nextPageFooter].forEach((button) => {
    button.disabled = totalResults === 0 || state.page >= totalPages;
  });
}

function changeEvidencePage(offset, focusTarget) {
  state.page += offset;
  render();
  focusTarget.focus();
}

function updateSummary() {
  ui.sourceCount.textContent = String(state.sources.filter((source) => source.state === "active").length);
  ui.reviewCount.textContent = String(state.claims.filter((claim) => claim.state === "active" && claim.reviewState === "needs_review").length);
  ui.internalCount.textContent = String(state.claims.filter((claim) => claim.state === "active" && claim.visibility === "internal_approved").length);
  ui.publicCount.textContent = String(state.claims.filter((claim) => claim.state === "active" && claim.visibility === "public_approved").length);
  ui.conflictCount.textContent = String(state.conflicts.filter((conflict) => conflict.state === "unresolved").length);
}

function renderConflictReview() {
  const selectedCount = state.selectedClaimIds.size;
  ui.selectionStatus.textContent = selectedCount === 0
    ? "No claims selected"
    : selectedCount === 1
      ? "1 claim selected"
      : `${selectedCount} claims selected`;
  ui.selectionHelp.textContent = selectedCount < 2
    ? "Select at least two active claims."
    : selectedCount <= 5
      ? "Review the exact propositions before declaring a conflict."
      : "A conflict can contain no more than five claims.";
  ui.clearSelection.disabled = selectedCount === 0;
  ui.reviewConflict.disabled = selectedCount < 2 || selectedCount > 5;

  ui.conflictList.replaceChildren();
  if (state.conflicts.length === 0) {
    ui.conflictList.append(emptyState(
      "No conflict history",
      "Select claims from the evidence queue when reviewed propositions disagree.",
    ));
    return;
  }
  [...state.conflicts]
    .sort((left, right) =>
      Number(left.state === "resolved") - Number(right.state === "resolved") ||
      right.updatedAt.localeCompare(left.updatedAt)
    )
    .forEach((conflict) => ui.conflictList.append(renderConflictGroup(conflict)));
}

function renderConflictGroup(conflict) {
  const card = el("article", `conflict-group${conflict.state === "resolved" ? " is-resolved" : ""}`);
  const header = el("div", "conflict-group-header");
  const heading = el("div");
  const badges = el("div", "badge-row");
  badges.append(badge(humanize(conflict.state), badgeClass(conflict.state)));
  heading.append(
    badges,
    el("h3", "conflict-group-title", conflict.state === "unresolved"
      ? "Evidence withheld pending review"
      : "Resolved conflict history"),
  );
  header.append(heading);
  if (conflict.state === "unresolved") {
    header.append(actionButton(
      "Review resolution",
      "button button-secondary button-small",
      () => openConfirmation({
        kind: "conflict_resolve",
        conflict,
        claims: claimsForConflict(conflict),
      }),
    ));
  }
  const members = el("ul", "conflict-members");
  claimsForConflict(conflict).forEach((claim) => {
    const item = el("li", "conflict-member");
    const source = sourceForClaim(claim);
    item.append(
      el("strong", "", claim.proposition),
      el("span", "", source ? `${source.title} · ${humanize(claim.state)}` : humanize(claim.state)),
    );
    members.append(item);
  });
  const missingCount = conflict.claimIds.length - members.children.length;
  if (missingCount > 0) {
    members.append(el(
      "li",
      "conflict-member",
      `${missingCount} referenced claim${missingCount === 1 ? " is" : "s are"} unavailable in this scope.`,
    ));
  }
  card.append(
    header,
    members,
    el("p", "conflict-meta", `Declared by ${conflict.reviewedBy}. Last updated ${formatDate(conflict.updatedAt)}.`),
  );
  return card;
}

function toggleConflictSelection(claimId) {
  if (state.selectedClaimIds.has(claimId)) {
    state.selectedClaimIds.delete(claimId);
  } else if (state.selectedClaimIds.size < 5) {
    state.selectedClaimIds.add(claimId);
  }
  render();
}

function selectedClaims() {
  return state.claims.filter((claim) => state.selectedClaimIds.has(claim.id));
}

function claimsForConflict(conflict) {
  const members = new Set(conflict.claimIds);
  return state.claims.filter((claim) => members.has(claim.id));
}

function unresolvedConflictFor(claimId) {
  return state.conflicts.find((conflict) =>
    conflict.state === "unresolved" && conflict.claimIds.includes(claimId)
  );
}

function sourceForClaim(claim) {
  return state.sources.find((source) => source.id === claim.sourceId);
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
  const context = el("dl", "source-context");
  context.append(
    sourceContextItem("Captured", formatDate(source.capturedAt)),
    sourceContextItem("Updated", formatDate(source.updatedAt)),
    sourceContextItem("Reviewed", source.lastReviewedAt ? formatDate(source.lastReviewedAt) : "Not reviewed"),
    sourceContextItem("Fingerprint", shortenedFingerprint(source.sourceHash), true),
  );
  details.append(context);
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
  disclosure.open = Boolean(state.query) || state.expandedSourceIds.has(source.id);
  disclosure.addEventListener("toggle", () => {
    if (disclosure.open) {
      state.expandedSourceIds.add(source.id);
    } else {
      state.expandedSourceIds.delete(source.id);
    }
  });
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
  const conflict = unresolvedConflictFor(claim.id);
  const details = el("div");
  const badges = el("div", "badge-row");
  badges.append(badge(humanize(claim.maturity)), badge(humanize(claim.visibility), badgeClass(claim.visibility)), badge(humanize(claim.reviewState), badgeClass(claim.reviewState)), badge(humanize(claim.state), badgeClass(claim.state)));
  if (conflict) badges.append(badge("Unresolved conflict", "badge-sensitive"));
  details.append(badges, el("h4", "claim-title", claim.title), el("p", "claim-proposition", claim.proposition), el("p", "claim-contribution", claim.contribution));
  const actions = el("div", "claim-actions");
  if (claim.state === "active") {
    if (!conflict) {
      const selected = state.selectedClaimIds.has(claim.id);
      const selection = actionButton(
        selected ? "Selected for conflict" : "Select for conflict",
        "button button-quiet button-small conflict-toggle",
        () => toggleConflictSelection(claim.id),
      );
      selection.setAttribute("aria-pressed", String(selected));
      selection.disabled = !selected && state.selectedClaimIds.size >= 5;
      actions.append(selection);
    }
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
  if (conflict) card.append(el("p", "claim-policy", "This claim is withheld while its explicit conflict group remains unresolved."));
  else if (claim.state === "active" && source.reviewState !== "approved") card.append(el("p", "claim-policy", "Approve this source before approving its claims."));
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
  ui.conflictConfirm.checked = false;
  ui.decisionEvidence.replaceChildren();
  const isPublic = decision.kind === "claim_public";
  const isConflictDeclaration = decision.kind === "conflict_declare";
  const isConflictResolution = decision.kind === "conflict_resolve";
  ui.publicConfirmation.hidden = !isPublic;
  ui.conflictConfirmation.hidden = !isConflictDeclaration;
  ui.decisionEyebrow.textContent = isPublic
    ? "Public eligibility"
    : isConflictDeclaration || isConflictResolution
      ? "Human-reviewed evidence conflict"
      : "Destructive evidence decision";
  ui.decisionTitle.textContent = isPublic
    ? "Approve this exact public claim?"
    : isConflictDeclaration
      ? "Declare these claims in conflict?"
      : isConflictResolution
        ? "Resolve this conflict group?"
        : decision.kind === "source_revoke"
          ? "Revoke this source?"
          : "Revoke this claim?";
  ui.decisionCopy.textContent = isPublic
    ? "This makes the exact claim eligible for recruiter-facing retrieval. It does not publish, send, or edit anything."
    : isConflictDeclaration
      ? "Jolene will withhold these propositions from public assertions until you explicitly resolve the group."
      : isConflictResolution
        ? "Resolution restores normal eligibility checks. It does not choose a winning claim, approve evidence, or publish anything."
        : "Revocation removes this evidence from eligible retrieval. The audit record remains.";
  if (isConflictDeclaration || isConflictResolution) {
    decision.claims.forEach((claim) => {
      const source = sourceForClaim(claim);
      const item = el("div", "decision-conflict-member");
      item.append(
        el("strong", "", claim.proposition),
        el("span", "", source?.title || "Source unavailable"),
      );
      ui.decisionEvidence.append(item);
    });
  } else {
    const record = decision.claim || decision.source;
    ui.decisionEvidence.append(el("strong", "", record.proposition || record.title));
    const citation = decision.source?.provenanceUri || decision.source?.provenanceRef;
    if (citation) ui.decisionEvidence.append(el("span", "", "Evidence: " + citation));
  }
  ui.decisionSubmit.textContent = isPublic
    ? "Approve for public answers"
    : isConflictDeclaration
      ? "Declare unresolved conflict"
      : isConflictResolution
        ? "Resolve conflict"
        : "Revoke evidence";
  ui.decisionSubmit.className = isPublic || isConflictDeclaration
    ? "button button-primary"
    : "button button-danger";
  ui.decisionDialog.showModal();
  if (isPublic) ui.publicConfirm.focus();
  else if (isConflictDeclaration) ui.conflictConfirm.focus();
  else ui.decisionSubmit.focus();
}

async function submitConfirmedDecision(event) {
  event.preventDefault();
  if (!state.pendingDecision) return;
  if (state.pendingDecision.kind === "claim_public" && !ui.publicConfirm.checked) {
    showInlineError("Confirm the exact recruiter-facing claim before approval.");
    return;
  }
  if (state.pendingDecision.kind === "conflict_declare" && !ui.conflictConfirm.checked) {
    showInlineError("Confirm that the exact selected claims conflict before declaring the group.");
    return;
  }
  ui.decisionSubmit.disabled = true;
  try {
    if (state.pendingDecision.kind === "claim_public") await decideClaim(state.pendingDecision.claim, "approve_public", false);
    if (state.pendingDecision.kind === "claim_revoke") await mutate(`/v1/career-evidence/claims/${encodeURIComponent(state.pendingDecision.claim.id)}/revoke`, {});
    if (state.pendingDecision.kind === "source_revoke") await mutate(`/v1/career-evidence/sources/${encodeURIComponent(state.pendingDecision.source.id)}/revoke`, {});
    if (state.pendingDecision.kind === "conflict_declare") {
      await mutate("/v1/career-evidence/conflicts", {
        claimIds: state.pendingDecision.claims.map((claim) => claim.id),
        reviewerId: state.scope.actorId,
      });
      state.selectedClaimIds.clear();
    }
    if (state.pendingDecision.kind === "conflict_resolve") {
      await mutate(
        `/v1/career-evidence/conflicts/${encodeURIComponent(state.pendingDecision.conflict.id)}/resolve`,
        { reviewerId: state.scope.actorId },
      );
    }
    ui.decisionDialog.close();
    showToast(
      state.pendingDecision.kind === "claim_public"
        ? "Claim approved for public answers."
        : state.pendingDecision.kind === "conflict_declare"
          ? "Conflict declared. Affected evidence is now withheld."
          : state.pendingDecision.kind === "conflict_resolve"
            ? "Conflict resolved. Normal eligibility checks now apply."
            : "Evidence revoked.",
    );
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
  if (error.message === "career_evidence_conflict") return "One or more claims changed, became inactive, or already belong to another unresolved conflict. Refresh before deciding.";
  if (error.status === 404) return "This evidence record no longer exists in the owner scope.";
  return "Career evidence could not be updated. Check that Jolene is running, then retry.";
}

function actionButton(label, className, handler) { const element = el("button", className, label); element.type = "button"; element.addEventListener("click", handler); return element; }
function badge(label, extra = "") { return el("span", `badge ${extra}`.trim(), label); }
function badgeClass(value) { return ["approved", "internal_approved", "public_approved", "active"].includes(value) ? "badge-active" : ["rejected", "revoked"].includes(value) ? "badge-sensitive" : ["missing", "superseded"].includes(value) ? "badge-superseded" : ""; }
function humanize(value) { return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatDate(value) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? "at an unknown time" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsed); }
function shortenedFingerprint(value) { const normalized = String(value || "").trim(); return normalized ? `${normalized.slice(0, 12)}…` : "Unavailable"; }
function sourceContextItem(label, value, code = false) { const item = el("div"); const details = el("dd"); details.append(code ? el("code", "", value) : document.createTextNode(value)); item.append(el("dt", "", label), details); return item; }
function safePublicUrl(value) { if (value?.startsWith("/") && !value.startsWith("//")) return true; try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } }
function emptyState(title, copy) { const container = el("div", "empty-state"); container.append(el("strong", "", title), el("p", "", copy)); return container; }
function errorState(copy) { const container = el("div", "error-state"); container.append(el("strong", "", "Evidence unavailable"), el("p", "", copy)); return container; }
function el(tag, className = "", text = "") { const element = document.createElement(tag); if (className) element.className = className; if (text) element.textContent = text; return element; }
function showNotice(message, isError = false) { ui.notice.textContent = message; ui.notice.classList.toggle("is-error", isError); ui.notice.hidden = false; }
function clearNotice() { ui.notice.hidden = true; ui.notice.textContent = ""; }
function showInlineError(message) { ui.decisionError.textContent = message; ui.decisionError.hidden = false; }
function showToast(message) { ui.toast.textContent = message; ui.toast.hidden = false; window.clearTimeout(showToast.timer); showToast.timer = window.setTimeout(() => { ui.toast.hidden = true; }, 3200); }
