const state = {
  projects: [],
  snapshots: new Map(),
  failures: new Set(),
};

const ui = {
  list: document.querySelector("#project-list"),
  refreshAll: document.querySelector("#refresh-all"),
  notice: document.querySelector("#page-notice"),
  configured: document.querySelector("#count-configured"),
  attention: document.querySelector("#count-attention"),
  plans: document.querySelector("#count-plans"),
  lastUpdated: document.querySelector("#last-updated"),
  toast: document.querySelector("#toast"),
};

const alertCopy = {
  root_missing: "The configured project folder is missing.",
  git_not_initialized: "Git has not been initialized for this project.",
  git_unavailable: "Git status could not be read. Retry after checking the local repository.",
  plan_missing: "The configured project plan could not be found.",
  plan_stale: "The project plan is older than its review window.",
  uncommitted_changes: "The project has local changes that have not been committed.",
};

initialize();

function initialize() {
  ui.refreshAll.addEventListener("click", refreshAll);
  refreshAll();
}

async function refreshAll() {
  setBusy(true);
  clearNotice();
  setLoading("Checking configured projects…");
  state.snapshots.clear();
  state.failures.clear();

  try {
    state.projects = await api("/v1/watched-projects");
  } catch (error) {
    state.projects = [];
    renderSummary();
    renderPageError(friendlyError(error));
    setBusy(false);
    return;
  }

  if (state.projects.length === 0) {
    renderSummary();
    renderProjects();
    ui.lastUpdated.textContent = "No projects configured";
    setBusy(false);
    return;
  }

  const results = await Promise.allSettled(
    state.projects.map((project) => loadSnapshot(project.id)),
  );
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      const project = state.projects[index];
      if (project) state.failures.add(project.id);
    }
  });

  renderSummary();
  renderProjects();
  ui.lastUpdated.textContent = "Checked " + formatDate(new Date().toISOString());
  if (state.failures.size > 0) {
    showNotice("Some projects could not be checked. Their last state is not shown; retry when the local service is available.", true);
  }
  setBusy(false);
}

async function loadSnapshot(id) {
  const snapshot = await api("/v1/watched-projects/" + encodeURIComponent(id) + "/snapshot");
  state.snapshots.set(id, snapshot);
  return snapshot;
}

async function refreshProject(project, button) {
  button.disabled = true;
  clearNotice();
  try {
    state.snapshots.set(project.id, await loadSnapshot(project.id));
    state.failures.delete(project.id);
    renderSummary();
    renderProjects();
    ui.lastUpdated.textContent = "Checked " + formatDate(new Date().toISOString());
    showToast(project.label + " checked. No changes were made.");
  } catch (error) {
    state.failures.add(project.id);
    renderProjects();
    showNotice(friendlyError(error), true);
  }
}

function renderSummary() {
  const snapshots = [...state.snapshots.values()];
  ui.configured.textContent = String(state.projects.length);
  ui.attention.textContent = String(
    snapshots.filter((snapshot) => snapshot.alerts.length > 0).length + state.failures.size,
  );
  ui.plans.textContent = String(snapshots.filter((snapshot) => snapshot.plan.exists).length);
}

function renderProjects() {
  ui.list.replaceChildren();
  ui.list.setAttribute("aria-busy", "false");

  if (state.projects.length === 0) {
    ui.list.append(emptyState(
      "No projects configured",
      "Add an explicit local project to Jolene’s watched-project registry before checking status.",
    ));
    return;
  }

  state.projects.forEach((project) => {
    const snapshot = state.snapshots.get(project.id);
    ui.list.append(snapshot ? projectCard(project, snapshot) : failedCard(project));
  });
}

function projectCard(project, snapshot) {
  const card = el("article", "project-card");
  if (snapshot.alerts.length > 0) card.classList.add("has-attention");

  const heading = el("div", "project-heading");
  const title = el("div");
  title.append(
    el("p", "eyebrow", snapshot.alerts.length > 0 ? "Attention available" : "Current snapshot"),
    el("h3", "", project.label),
  );
  const refresh = button("Check again", "button button-secondary button-small");
  refresh.setAttribute("aria-label", "Check " + project.label + " again");
  refresh.addEventListener("click", () => refreshProject(project, refresh));
  heading.append(title, refresh);
  card.append(heading);

  const statuses = el("div", "project-status");
  statuses.append(
    badge(snapshot.rootExists ? "Folder found" : "Folder missing", snapshot.rootExists ? "badge-ok" : "badge-attention"),
    badge(gitLabel(snapshot.git), snapshot.git.state === "available" ? "badge-ok" : "badge-attention"),
    badge(planLabel(snapshot.plan), snapshot.plan.exists && !snapshot.alerts.includes("plan_stale") ? "badge-ok" : "badge-attention"),
  );
  card.append(statuses);

  const facts = el("div", "project-facts");
  facts.append(
    fact("Git branch", snapshot.git.branch || "Not available"),
    fact("Revision", shorten(snapshot.git.revision)),
    fact("Local changes", changeLabel(snapshot.git)),
    fact("Project plan", snapshot.plan.relativePath || "Not configured"),
    fact("Plan age", planAge(snapshot.plan)),
    fact("Build verification", "Not configured"),
  );
  card.append(facts);

  if (snapshot.alerts.length > 0) {
    const alerts = el("div", "project-alerts");
    snapshot.alerts.forEach((alert) => alerts.append(el("p", "project-alert", alertCopy[alert] || humanize(alert))));
    card.append(alerts);
  } else {
    card.append(el("p", "project-clear", "No configured project alerts were found."));
  }
  card.append(el("div", "meta-list", "Checked " + formatDate(snapshot.checkedAt)));
  return card;
}

function failedCard(project) {
  const card = el("article", "project-card has-attention");
  card.append(el("p", "eyebrow", "Check unavailable"), el("h3", "", project.label));
  card.append(el("p", "project-alert", "Jolene could not read a fresh snapshot for this project."));
  const refresh = button("Retry check", "button button-secondary button-small");
  refresh.addEventListener("click", () => refreshProject(project, refresh));
  const actions = el("div", "card-actions");
  actions.append(refresh);
  card.append(actions);
  return card;
}

function fact(label, value) {
  const node = el("div", "project-fact");
  node.append(el("span", "", label), el("strong", "", value));
  return node;
}

function gitLabel(git) {
  if (git.state === "available") return "Git available";
  if (git.state === "not_repository") return "No Git boundary";
  return "Git unavailable";
}

function planLabel(plan) {
  if (!plan.configured) return "No plan configured";
  return plan.exists ? "Plan found" : "Plan missing";
}

function planAge(plan) {
  if (!plan.exists || plan.ageDays === null) return "Not available";
  if (plan.ageDays === 0) return "Updated today";
  return plan.ageDays + (plan.ageDays === 1 ? " day" : " days");
}

function changeLabel(git) {
  if (git.dirty === null) return "Not available";
  if (!git.dirty) return "None detected";
  return git.changedFileCount + (git.changedFileCount === 1 ? " file" : " files");
}

function shorten(value) {
  if (!value) return "Not available";
  return value.length > 12 ? value.slice(0, 12) : value;
}

function humanize(value) {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "at an unknown time"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

async function api(path) {
  const response = await fetch(path, { headers: { accept: "application/json" } });
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
  if (error && error.status === 404) return "That watched project is no longer configured. Refresh the project list.";
  return "Jolene’s local Project Watch service is unavailable. Check that the local service is running, then retry.";
}

function setBusy(busy) {
  ui.refreshAll.disabled = busy;
  ui.refreshAll.textContent = busy ? "Checking projects…" : "Check all projects";
}

function setLoading(message) {
  ui.list.replaceChildren(el("div", "loading-state", message));
  ui.list.setAttribute("aria-busy", "true");
}

function renderPageError(message) {
  const node = el("div", "error-state");
  node.append(el("strong", "", "Couldn’t load Project Watch"), el("p", "", message));
  ui.list.replaceChildren(node);
  ui.list.setAttribute("aria-busy", "false");
}

function emptyState(title, message) {
  const node = el("div", "empty-state");
  node.append(el("strong", "", title), el("p", "", message));
  return node;
}

function badge(label, extraClass) {
  return el("span", "badge " + extraClass, label);
}

function button(label, className) {
  const node = el("button", className, label);
  node.type = "button";
  return node;
}

function el(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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

let toastTimer;
function showToast(message) {
  window.clearTimeout(toastTimer);
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  toastTimer = window.setTimeout(() => { ui.toast.hidden = true; }, 3400);
}
