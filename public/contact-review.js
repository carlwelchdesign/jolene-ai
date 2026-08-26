const state = {
  scope: null,
  contacts: [],
  filter: "pending_review",
};

const ui = {
  scopeChip: document.querySelector("#scope-chip"),
  notice: document.querySelector("#page-notice"),
  refreshButton: document.querySelector("#refresh-button"),
  contactList: document.querySelector("#contact-list"),
  countPending: document.querySelector("#count-pending"),
  countReviewed: document.querySelector("#count-reviewed"),
  countDrafts: document.querySelector("#count-drafts"),
  draftDialog: document.querySelector("#draft-dialog"),
  draftForm: document.querySelector("#draft-form"),
  draftRecipient: document.querySelector("#draft-recipient"),
  draftId: document.querySelector("#draft-id"),
  draftContent: document.querySelector("#draft-content"),
  draftError: document.querySelector("#draft-error"),
  draftSubmit: document.querySelector("#draft-submit"),
  deleteDialog: document.querySelector("#delete-dialog"),
  deleteForm: document.querySelector("#delete-form"),
  deleteCopy: document.querySelector("#delete-copy"),
  deleteId: document.querySelector("#delete-id"),
  deleteConfirm: document.querySelector("#delete-confirm"),
  deleteError: document.querySelector("#delete-error"),
  deleteSubmit: document.querySelector("#delete-submit"),
  toast: document.querySelector("#toast"),
};

initialize();

function initialize() {
  wireDialogs();
  wireFilters();
  ui.refreshButton.addEventListener("click", refresh);
  ui.draftForm.addEventListener("submit", saveDraft);
  ui.deleteForm.addEventListener("submit", deleteContact);
  ui.deleteConfirm.addEventListener("change", () => {
    ui.deleteSubmit.disabled = !ui.deleteConfirm.checked;
  });
  refresh();
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
  document.querySelectorAll("[data-contact-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.contactFilter;
      document.querySelectorAll("[data-contact-filter]").forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle("is-active", active);
        candidate.setAttribute("aria-pressed", String(active));
      });
      renderContacts();
    });
  });
}

async function refresh() {
  clearNotice();
  ui.refreshButton.disabled = true;
  setLoading();
  try {
    state.scope = await api("/v1/contact-intents/scope");
    ui.scopeChip.replaceChildren(
      el("span", "", "●", { "aria-hidden": "true" }),
      document.createTextNode(`${state.scope.actorId} · ${state.scope.workspaceId}`),
    );
    state.contacts = await api(`/v1/contact-intents${scopeQuery()}`);
    renderSummary();
    renderContacts();
  } catch (error) {
    renderError(friendlyError(error));
  } finally {
    ui.refreshButton.disabled = false;
  }
}

function renderSummary() {
  ui.countPending.textContent = String(
    state.contacts.filter((contact) => contact.status === "pending_review").length,
  );
  ui.countReviewed.textContent = String(
    state.contacts.filter((contact) => contact.status === "reviewed").length,
  );
  ui.countDrafts.textContent = String(
    state.contacts.filter((contact) => Boolean(contact.replyDraft)).length,
  );
}

function renderContacts() {
  ui.contactList.replaceChildren();
  ui.contactList.setAttribute("aria-busy", "false");
  const contacts = state.filter === "all"
    ? state.contacts
    : state.contacts.filter((contact) => contact.status === state.filter);
  if (contacts.length === 0) {
    ui.contactList.append(emptyState(
      state.filter === "pending_review" ? "Nothing waiting" : "No contacts here",
      state.filter === "pending_review"
        ? "There are no consented contact requests waiting for review."
        : "Choose another filter to review the local queue.",
    ));
    return;
  }
  contacts.forEach((contact) => ui.contactList.append(contactCard(contact)));
}

function contactCard(contact) {
  const card = el("article", `contact-card${contact.status === "pending_review" ? " is-waiting" : ""}`);
  const badges = el("div", "badge-row");
  badges.append(
    badge(contact.status === "pending_review" ? "Waiting" : "Reviewed", `badge-${contact.status}`),
    badge("Consent recorded", "badge-active"),
  );
  if (contact.replyDraft) badges.append(badge("Local draft", "badge-active"));
  card.append(badges);
  card.append(el("h3", "contact-name", contact.name));
  card.append(el("p", "contact-address", contact.email));
  if (contact.organization) {
    card.append(el("p", "contact-organization", contact.organization));
  }
  card.append(el("div", "contact-message", contact.message));
  if (contact.replyDraft) {
    const draft = el("div", "reply-draft");
    draft.append(el("strong", "", "Saved reply draft"));
    draft.append(document.createTextNode(contact.replyDraft));
    card.append(draft);
  }
  const meta = el("div", "contact-meta");
  meta.append(
    el("span", "", `Submitted ${formatDate(contact.submittedAt)}`),
    el("span", "", `Expires ${formatDate(contact.expiresAt)}`),
  );
  if (contact.reviewedAt) {
    meta.append(el("span", "", `Reviewed ${formatDate(contact.reviewedAt)}`));
  }
  card.append(meta);

  const actions = el("div", "card-actions");
  if (contact.status === "pending_review") {
    const reviewed = button("Mark reviewed", "button button-secondary button-small");
    reviewed.addEventListener("click", () => markReviewed(contact, reviewed));
    actions.append(reviewed);
  }
  const draft = button(
    contact.replyDraft ? "Edit reply draft" : "Draft a reply",
    "button button-primary button-small",
  );
  draft.addEventListener("click", () => openDraft(contact));
  const remove = button("Delete", "button button-quiet button-small");
  remove.addEventListener("click", () => openDelete(contact));
  actions.append(draft, remove);
  card.append(actions);
  return card;
}

async function markReviewed(contact, control) {
  control.disabled = true;
  try {
    await api(`/v1/contact-intents/${encodeURIComponent(contact.intentId)}/review`, {
      method: "POST",
      body: state.scope,
    });
    showToast("Contact marked reviewed. Nothing was sent.");
    await loadContacts();
  } catch (error) {
    showNotice(friendlyError(error), true);
    control.disabled = false;
  }
}

function openDraft(contact) {
  ui.draftForm.reset();
  ui.draftId.value = contact.intentId;
  ui.draftContent.value = contact.replyDraft || "";
  ui.draftRecipient.textContent = `Possible reply to ${contact.name} at ${contact.email}. This remains local.`;
  clearInlineError(ui.draftError);
  ui.draftDialog.showModal();
  ui.draftContent.focus();
}

async function saveDraft(event) {
  event.preventDefault();
  ui.draftSubmit.disabled = true;
  clearInlineError(ui.draftError);
  try {
    await api(`/v1/contact-intents/${encodeURIComponent(ui.draftId.value)}/reply-draft`, {
      method: "POST",
      body: { ...state.scope, draft: ui.draftContent.value.trim() },
    });
    ui.draftDialog.close();
    showToast("Local reply draft saved. Nothing was sent.");
    await loadContacts();
  } catch (error) {
    showInlineError(ui.draftError, friendlyError(error));
  } finally {
    ui.draftSubmit.disabled = false;
  }
}

function openDelete(contact) {
  ui.deleteForm.reset();
  ui.deleteId.value = contact.intentId;
  ui.deleteCopy.textContent = `Delete the request from ${contact.name} at ${contact.email}, including any local reply draft?`;
  ui.deleteSubmit.disabled = true;
  clearInlineError(ui.deleteError);
  ui.deleteDialog.showModal();
  ui.deleteConfirm.focus();
}

async function deleteContact(event) {
  event.preventDefault();
  if (!ui.deleteConfirm.checked) return;
  ui.deleteSubmit.disabled = true;
  clearInlineError(ui.deleteError);
  try {
    await api(`/v1/contact-intents/${encodeURIComponent(ui.deleteId.value)}/delete`, {
      method: "POST",
      body: { ...state.scope, confirmation: "delete_contact_intent" },
    });
    ui.deleteDialog.close();
    showToast("Contact request permanently deleted.");
    await loadContacts();
  } catch (error) {
    showInlineError(ui.deleteError, friendlyError(error));
    ui.deleteSubmit.disabled = false;
  }
}

async function loadContacts() {
  state.contacts = await api(`/v1/contact-intents${scopeQuery()}`);
  renderSummary();
  renderContacts();
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
    const error = new Error(body && body.error ? body.error : "request_failed");
    error.status = response.status;
    throw error;
  }
  return body;
}

function friendlyError(error) {
  if (error && error.message === "invalid_request") return "Some contact information is invalid. Review the draft or confirmation and try again.";
  if (error && error.message === "contact_scope_not_permitted") return "This queue is available only in Carl's configured owner scope.";
  if (error && error.message === "contact_queue_unavailable") return "The local contact queue is unavailable. Check its file permissions and retry.";
  if (error && error.status === 404) return "That contact request is no longer available. Refresh the queue.";
  return "Jolene's local contact review service is unavailable. Check that the local service is running, then retry.";
}

function setLoading() {
  ui.contactList.setAttribute("aria-busy", "true");
  ui.contactList.replaceChildren(el("div", "loading-state", "Loading contact requests…"));
}

function renderError(message) {
  ui.contactList.setAttribute("aria-busy", "false");
  const state = el("div", "error-state");
  state.append(el("strong", "", "Contact queue unavailable"), el("p", "", message));
  ui.contactList.replaceChildren(state);
}

function emptyState(title, copy) {
  const state = el("div", "empty-state");
  state.append(el("strong", "", title), el("p", "", copy));
  return state;
}

function badge(text, className = "") {
  return el("span", `badge ${className}`.trim(), text);
}

function button(text, className) {
  const control = el("button", className, text);
  control.type = "button";
  return control;
}

function el(tag, className = "", text = "", attributes = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, value));
  return node;
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function showNotice(message, error = false) {
  ui.notice.textContent = message;
  ui.notice.classList.toggle("is-error", error);
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
  node.textContent = "";
  node.hidden = true;
}

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 4_000);
}
