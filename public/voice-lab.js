const dimensions = ["grounding", "usefulness", "originality", "emotional_calibration", "conversational_aliveness", "restraint"];
const state = { scope: null, snapshot: null };
const $ = (selector) => document.querySelector(selector);
$("#refresh").addEventListener("click", refresh);
$("#review").addEventListener("submit", save);
refresh();

async function refresh() {
  $("#packet").textContent = "Loading capture…"; $("#review").hidden = true;
  try {
    state.scope = await api("/v1/public-voice-lab-review/scope");
    $("#scope").textContent = `${state.scope.actorId} · ${state.scope.workspaceId}`;
    state.snapshot = await api(`/v1/public-voice-lab-review?actorId=${encodeURIComponent(state.scope.actorId)}&workspaceId=${encodeURIComponent(state.scope.workspaceId)}`);
    render();
  } catch (error) { $("#packet").textContent = friendly(error); }
}

function render() {
  const view = state.snapshot; const summary = $("#summary"); summary.replaceChildren();
  summary.textContent = `Capture: ${view.packetStatus} · Review: ${view.reviewStatus}`;
  if (!view.packet) { $("#packet").textContent = "No valid private voice-lab capture is available. Run the explicit live capture first."; return; }
  const packet = $("#packet"); packet.replaceChildren();
  view.packet.cases.forEach((item, index) => { const article = node("article", "case"); article.append(node("h2", "", `Case ${index + 1}: ${item.id}`), node("p", "meta", `${item.register} · ${item.executionMode || item.mode}`), node("p", "", item.prompt), node("div", "answer", item.answer), node("p", "meta", `Citations: ${item.citationIds.join(", ") || "none"}`)); packet.append(article); });
  renderForm(view.packet, view.decision); $("#review").hidden = false;
}

function renderForm(packet, decision) {
  const cases = $("#cases"); cases.replaceChildren(); const old = new Map((decision?.reviews || []).map((review) => [review.caseId, review]));
  packet.cases.forEach((item, index) => { const prior = old.get(item.id); const fieldset = node("fieldset", "case", "", { "data-case": item.id }); fieldset.append(node("legend", "", `Case ${index + 1}: ${item.id}`));
    const outcome = select(["approved", "revise", "rejected"], prior?.outcome || ""); outcome.dataset.outcome = "true"; fieldset.append(label("Outcome", outcome));
    const scores = node("div", "scores"); dimensions.forEach((dimension) => { const input = select(["0", "1", "2", "3", "4"], prior ? String(prior.scores[dimension]) : ""); input.dataset.score = dimension; scores.append(label(title(dimension), input)); }); fieldset.append(scores);
    const notes = document.createElement("textarea"); notes.maxLength = 2000; notes.dataset.notes = "true"; notes.value = prior?.notes || ""; fieldset.append(label("Notes (optional)", notes)); cases.append(fieldset); });
  $("#overall").value = decision?.overall || "";
}

async function save(event) { event.preventDefault(); const reviews = [...document.querySelectorAll("[data-case]")].map((field) => ({ caseId: field.dataset.case, outcome: field.querySelector("[data-outcome]").value, scores: Object.fromEntries(dimensions.map((key) => [key, Number(field.querySelector(`[data-score="${key}"]`).value)])), notes: field.querySelector("[data-notes]").value.trim() }));
  if (!$("#overall").value || reviews.some((review) => !review.outcome || Object.values(review.scores).some((score) => Number.isNaN(score)))) { show("Every outcome and score is required."); return; }
  try { await api("/v1/public-voice-lab-review/decision", { method:"POST", body: { ...state.scope, packetHash:state.snapshot.packetHash, overall:$("#overall").value, reviews } }); show("Review saved locally for this exact capture."); await refresh(); } catch (error) { show(friendly(error)); }
}
async function api(url, options = {}) { const response = await fetch(url, { method: options.method || "GET", headers: options.body ? { "content-type":"application/json" } : undefined, body: options.body ? JSON.stringify(options.body) : undefined }); const result = await response.json(); if (!response.ok) { const error = new Error(result.error || "request_failed"); error.code = result.error; throw error; } return result; }
function node(tag, className = "", text = "", attrs = {}) { const value = document.createElement(tag); if (className) value.className = className; if (text) value.textContent = text; Object.entries(attrs).forEach(([key, item]) => value.setAttribute(key, item)); return value; }
function select(values, current) { const value = document.createElement("select"); value.required = true; value.append(new Option("Choose", "")); values.forEach((item) => value.append(new Option(title(item), item))); value.value = current; return value; }
function label(text, control) { const value = document.createElement("label"); value.append(document.createTextNode(text), control); return value; }
function title(value) { return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function show(text) { const notice = $("#notice"); notice.textContent = text; notice.hidden = false; }
function friendly(error) { return error?.code === "public_voice_lab_review_scope_not_permitted" ? "This review is restricted to the configured owner scope." : "Voice-lab review could not be loaded or saved."; }
