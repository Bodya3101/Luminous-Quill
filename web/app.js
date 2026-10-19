const $ = (id) => document.getElementById(id);

function t(key, variables = {}) {
  let value = state.translations[key];
  if (typeof value !== "string") value = key;
  return value.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) =>
    variables[name] == null ? "" : String(variables[name]));
}

function applyStaticTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const value = t(element.dataset.i18n);
    const textNode = Array.from(element.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && node.nodeValue.trim().length > 0
    );
    if (textNode) {
      const original = textNode.nodeValue;
      const leading = original.match(/^\s*/)?.[0] || "";
      const trailing = original.match(/\s*$/)?.[0] || "";
      textNode.nodeValue = leading + value + trailing;
    } else {
      element.textContent = value;
    }
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder));
  });
  document.querySelectorAll("[data-i18n-title]").forEach((element) => {
    element.setAttribute("title", t(element.dataset.i18nTitle));
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAria));
  });
  document.querySelectorAll("[data-i18n-prompt]").forEach((element) => {
    element.setAttribute("data-prompt", t(element.dataset.i18nPrompt));
  });
  document.documentElement.lang = state.language;
  document.title = "LLuminous Quill";
  const languageSelect = $("language-select");
  if (languageSelect) languageSelect.value = state.language;
}

function applyAccent(color) {
  const allowed = ["green", "blue", "violet", "amber", "cyan", "rose"];
  state.accentColor = allowed.includes(color) ? color : "green";
  document.body.dataset.accent = state.accentColor;
  document.querySelectorAll("[data-accent-choice]").forEach((button) => {
    const selected = button.dataset.accentChoice === state.accentColor;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

async function loadLanguage(language) {
  const normalized = language === "en" ? "en" : "ru";
  const translations = await window.pywebview.api.get_translations(normalized);
  if (!translations || translations._error) throw new Error("Localization data could not be loaded.");
  state.language = normalized;
  state.translations = translations;
  applyStaticTranslations();
  renderProviderList();
  updateModelChip();
  refreshProviderEditorCopy();
}

async function persistUiSettings(updates) {
  const result = await window.pywebview.api.update_ui_settings(updates);
  if (!result || !result.ok) throw new Error((result && result.error) || t("settings_save_failed"));
  state.uiSettings = { ...state.uiSettings, ...result.settings };
  return result.settings;
}

function localizedError(message) {
  const value = String(message || "");
  const mapping = [
    ["Give this provider a name.", "err_enter_name"],
    ["Base URL must start with http:// or https://.", "err_base_url"],
    ["Credentials are not allowed inside the URL.", "err_url_credentials"],
    ["Enter a model identifier.", "err_enter_model"],
    ["Could not save the provider profile.", "err_provider_save"],
    ["Profile saved, but activation failed.", "err_activate"],
    ["Could not delete provider.", "err_provider_delete"],
    ["Provider profile not found.", "err_provider_not_found"],
    ["Invalid provider profile ID.", "err_invalid_provider_id"],
    ["Add and activate a provider with a model in Settings first.", "err_no_active_provider"],
    ["No API key for the active provider. Enter one in Settings or set LLQUILL_API_KEY.", "err_no_api_key"],
    ["Message cannot be empty.", "err_empty_message"],
    ["Could not retrieve run status.", "err_run_state"],
    ["Could not start the agent.", "err_run_start"]
  ];
  const match = mapping.find(([source]) => value.includes(source));
  return match ? t(match[1]) : value;
}

const state = {
  runId: null,
  lastEventId: 0,
  pollTimer: null,
  busy: false,
  history: [],
  seenApprovals: new Set(),
  providers: [],
  activeProviderId: "",
  editingProviderId: null,
  editingHasKey: false,
  clearKeyOnSave: false,
  formDirty: false,
  bootstrapped: false,
  language: "ru",
  accentColor: "green",
  translations: {},
  uiSettings: { language: "ru", accent_color: "green" }
};

function escapeHTML(value) {
  return String(value == null ? "" : value).replace(/[&<>"]/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"
  })[ch]);
}

function toast(message, type = "success") {
  const element = $("toast");
  element.textContent = message;
  element.classList.remove("hidden", "error", "success");
  element.classList.add(type);
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.add("hidden"), 4300);
}

function showView(view) {
  if (view !== "settings" && state.formDirty) {
    if (!window.confirm(t("discard_changes_confirm"))) return;
    state.formDirty = false;
    if (state.editingProviderId && state.providers.some((provider) => provider.id === state.editingProviderId)) loadProviderIntoForm(state.editingProviderId);
    else createProviderDraft(false);
  }
  const settingsVisible = view === "settings";
  $("settings-view").classList.toggle("hidden", !settingsVisible);
  $("chat-view").classList.toggle("hidden", settingsVisible);
  $("nav-settings").classList.toggle("active", settingsVisible);
  $("nav-chat").classList.toggle("active", !settingsVisible);
  $("view-title").textContent = settingsVisible ? t("settings_title") : (state.history.length ? t("chat_title") : t("new_chat"));
  $("top-eyebrow").textContent = settingsVisible ? t("settings_eyebrow") : t("workspace_eyebrow");
  if (settingsVisible) requestAnimationFrame(() => $("settings-view").scrollTo({ top: 0, behavior: "smooth" }));
}

function scrollToBottom(force = false) {
  const scroller = $("chat-scroll");
  const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  if (force || distanceFromBottom < 140) {
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }
}

function addMessage(role, content) {
  $("welcome").classList.add("hidden");
  const node = document.createElement("article");
  node.className = "message " + role;
  const name = role === "user" ? t("user_role") : "Quill";
  const avatar = role === "user" ? "B" : '<img src="../assets/icons/LLM_response.svg" alt="">';
  node.innerHTML = '<div class="avatar">' + avatar + '</div>' +
    '<div class="message-body"><div class="message-meta"><span class="message-role">' + name +
    '</span><span>' + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) +
    '</span></div><div class="message-content">' + escapeHTML(content) + '</div></div>';
  $("messages").appendChild(node);
  scrollToBottom();
}

function addActivity(title, detail = "", type = "") {
  const node = document.createElement("div");
  node.className = "activity-card " + (type === "denied" ? "denied" : "");
  node.innerHTML = '<div class="activity-header"><span class="activity-symbol">' +
    (type === "denied" ? "⊘" : "↳") + '</span><span>' + escapeHTML(title) + '</span></div>' +
    (detail ? '<div class="activity-detail">' + escapeHTML(detail) + '</div>' : "");
  $("activity-list").appendChild(node);
  scrollToBottom();
}

function showThinking(step) {
  $("thinking-indicator")?.remove();
  const node = document.createElement("div");
  node.id = "thinking-indicator";
  node.className = "activity-card thinking-card";
  node.innerHTML = '<div class="activity-header"><span class="activity-symbol thinking-symbol">✳</span>' +
    '<span>' + escapeHTML(t("tool_model_thinking", { step })) + '</span>' +
    '<span class="thinking-dots" aria-label="…"><i></i><i></i><i></i></span></div>';
  $("activity-list").appendChild(node);
  scrollToBottom();
}

function hideThinking() {
  $("thinking-indicator")?.remove();
}

async function resolveApproval(approvalId, approved, card) {
  card.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  try {
    const result = await window.pywebview.api.resolve_approval(state.runId, approvalId, approved);
    if (!result.ok) throw new Error(result.error || t("approval_request_gone"));
    card.classList.add("approval-resolved");
    card.querySelector(".approval-actions").innerHTML = approved
      ? '<span class="approval-result approved-result">' + escapeHTML(t("approval_allowed")) + '</span>'
      : '<span class="approval-result rejected-result">' + escapeHTML(t("approval_rejected")) + '</span>';
  } catch (error) {
    toast(error.message || String(error), "error");
    card.querySelectorAll("button").forEach((button) => { button.disabled = false; });
  }
}

function renderApproval(event) {
  const data = event.data || {};
  if (state.seenApprovals.has(data.approval_id)) return;
  state.seenApprovals.add(data.approval_id);
  let summary = data.summary || data.tool || "";
  const path = String((data.arguments || {}).path || "");
  if (String(data.tool).endsWith("delete_file")) summary = t("approve_file_delete", { path });
  else if (String(data.tool).endsWith("write_file")) summary = t("approve_file_write", { path });
  const card = document.createElement("article");
  card.className = "approval-card";
  card.innerHTML = '<div class="approval-title-row"><span class="approval-icon">⚠</span>' +
    '<h3>' + escapeHTML(t("approval_title")) + '</h3><span class="approval-tag">' + escapeHTML(t("approval_tag")) + '</span></div>' +
    '<p>' + escapeHTML(summary) + '</p>' +
    '<div class="approval-actions"><button class="approve">✓ ' + escapeHTML(t("approval_allow")) + '</button>' +
    '<button class="reject">' + escapeHTML(t("approval_reject")) + '</button></div>';
  card.querySelector(".approve").addEventListener("click", () => resolveApproval(data.approval_id, true, card));
  card.querySelector(".reject").addEventListener("click", () => resolveApproval(data.approval_id, false, card));
  $("approval-list").appendChild(card);
  scrollToBottom();
}

function renderEvent(event) {
  const data = event.data || {};
  switch (event.type) {
    case "model.requested": showThinking(data.turn || 1); break;
    case "tool.requested":
      hideThinking();
      addActivity(t("tool_requested", { tool: data.tool || "tool" }), JSON.stringify(data.arguments || {}, null, 2));
      break;
    case "tool.started":
      addActivity(t("tool_running", { tool: data.tool || "tool" }), JSON.stringify(data.arguments || {}, null, 2));
      break;
    case "tool.completed":
      addActivity(t("tool_completed", { tool: data.tool || "tool" }), JSON.stringify(data.result || {}, null, 2));
      break;
    case "tool.denied":
      hideThinking();
      addActivity(t("tool_denied"), localizedError(data.reason || t("permission_denied")), "denied");
      break;
    case "tool.failed":
      addActivity(t("tool_failed", { tool: data.tool || "" }), localizedError(data.error || ""), "denied");
      break;
    case "approval.required": hideThinking(); renderApproval(event); break;
    case "approval.expired": addActivity(t("approval_expired"), data.tool || "", "denied"); break;
    case "assistant.message":
      hideThinking();
      addMessage("assistant", data.content || "");
      state.history.push({ role: "assistant", content: data.content || "" });
      $("token-counter").textContent = t("context_tokens") + ": ≈" +
        Math.ceil(state.history.map((message) => message.content).join("\n").length / 3.6) +
        " " + t("token_unit") + " · " + t("token_estimate").toLowerCase();
      break;
    case "usage.updated":
      if (data.input_tokens != null && data.output_tokens != null) $("token-counter").textContent =
        t("last_request_tokens") + ": " + data.input_tokens + " " + t("input_tokens") + " / " + data.output_tokens + " " + t("output_tokens");
      break;
    case "run.failed":
      hideThinking();
      addActivity(t("run_failed"), localizedError(data.error || "Unknown error."), "denied");
      toast(localizedError(data.error || "Unknown error."), "error");
      break;
    case "run.completed": hideThinking(); addActivity(t("run_completed")); break;
    case "run.cancelled": hideThinking(); addActivity(t("run_cancelled")); break;
  }
}

function stopPolling() {
  if (state.pollTimer) clearTimeout(state.pollTimer);
  state.pollTimer = null;
}

async function pollRun(runId) {
  if (state.runId !== runId) return;
  try {
    const result = await window.pywebview.api.get_run_state(runId, state.lastEventId);
    if (!result.ok) throw new Error(result.error || t("err_run_state"));
    (result.events || []).forEach((event) => {
      renderEvent(event);
      state.lastEventId = Math.max(state.lastEventId, event.id);
    });
    if (["completed", "failed", "cancelled"].includes(result.status)) {
      stopPolling();
      state.busy = false;
      $("send-button").disabled = false;
      $("send-button").textContent = "↑";
      return;
    }
  } catch (error) {
    toast(error.message || String(error), "error");
    stopPolling();
    state.busy = false;
    $("send-button").disabled = false;
    $("send-button").textContent = "↑";
  }
  state.pollTimer = setTimeout(() => pollRun(runId), 500);
}

async function sendMessage(value) {
  const text = String(value == null ? $("message-input").value : value).trim();
  if (!text || state.busy) return;
  if (!window.pywebview || !window.pywebview.api) { toast(t("err_app_not_running"), "error"); return; }
  if (!state.activeProviderId) { showView("settings"); toast(t("err_no_active_provider"), "error"); return; }
  $("message-input").value = "";
  $("message-input").style.height = "auto";
  addMessage("user", text);
  state.history.push({ role: "user", content: text });
  showView("chat");
  state.busy = true;
  $("send-button").disabled = true;
  $("send-button").textContent = "…";
  state.lastEventId = 0;
  state.seenApprovals.clear();
  $("activity-list").innerHTML = "";
  $("approval-list").innerHTML = "";
  hideThinking();
  try {
    const result = await window.pywebview.api.start_run(text, state.history.slice(0, -1));
    if (!result.ok) throw new Error(result.error || t("err_run_start"));
    state.runId = result.run_id;
    pollRun(state.runId);
  } catch (error) {
    state.busy = false;
    $("send-button").disabled = false;
    $("send-button").textContent = "↑";
    addActivity(t("err_run_start"), localizedError(error.message || String(error)), "denied");
    toast(localizedError(error.message || String(error)), "error");
  }
}

function activeProvider() {
  return state.providers.find((provider) => provider.id === state.activeProviderId) || null;
}

function updateModelChip() {
  const provider = activeProvider();
  $("model-label").textContent = provider
    ? ((provider.name ? provider.name + " · " : "") + (provider.model || t("provider_empty_model")))
    : t("model_not_selected");
  $("model-chip").title = provider ? provider.name + " / " + provider.model : t("open_provider_settings");
}

function providerIcon(name) {
  const clean = String(name || "").trim();
  return clean ? escapeHTML(clean.slice(0, 1).toUpperCase()) : "◈";
}

function renderProviderList() {
  const list = $("provider-list");
  if (!list) return;
  list.innerHTML = "";
  $("provider-count").textContent = String(state.providers.length);
  if (!state.providers.length) {
    const empty = document.createElement("div");
    empty.className = "provider-list-empty";
    empty.innerHTML = '<span class="empty-provider-icon">＋</span><span>' + escapeHTML(t("empty_profiles")) +
      '</span><span>' + escapeHTML(t("empty_profiles_hint")) + '</span>';
    list.appendChild(empty);
    return;
  }
  for (const provider of state.providers) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "provider-card" + (provider.id === state.editingProviderId ? " selected" : "");
    const activeLabel = provider.id === state.activeProviderId
      ? '<span class="provider-card-active">' + escapeHTML(t("active_badge")) + '</span>' : "";
    card.innerHTML = '<span class="provider-card-orb">' + providerIcon(provider.name) + '</span>' +
      '<span class="provider-card-content"><span class="provider-card-top"><span class="provider-card-name">' +
      escapeHTML(provider.name) + '</span></span><span class="provider-card-model">' +
      escapeHTML(provider.model || t("provider_empty_model")) + '</span>' + activeLabel + '</span>';
    card.addEventListener("click", () => {
      if (state.editingProviderId === provider.id && !state.formDirty) return;
      if (state.formDirty && !window.confirm(t("discard_profile_confirm"))) return;
      loadProviderIntoForm(provider.id);
    });
    list.appendChild(card);
  }
}

function setEditorStatus(message, type = "") {
  const status = $("provider-editor-status");
  status.textContent = message;
  status.classList.remove("status-error", "status-success", "status-warning");
  if (type) status.classList.add("status-" + type);
}

function refreshProviderEditorCopy() {
  const provider = state.providers.find((item) => item.id === state.editingProviderId);
  $("provider-form-status").textContent = provider ? t("provider_profile") : t("new_profile_short");
  $("provider-form-title").textContent = provider ? provider.name : t("new_provider");
  $("save-provider").textContent = t("save_provider");
  $("delete-provider").textContent = t("delete_provider");
  $("delete-provider").classList.toggle("hidden", !provider);
  $("provider-active-badge").classList.toggle("hidden", !provider || provider.id !== state.activeProviderId);
  const activate = $("activate-provider");
  const isActive = Boolean(provider && provider.id === state.activeProviderId);
  activate.innerHTML = '<span>' + escapeHTML(isActive ? t("already_active") : t("save_and_activate")) + '</span>' + (isActive ? " ✓" : " ↗");
  activate.disabled = isActive;
  if (state.clearKeyOnSave) {
    $("key-status").textContent = t("key_note_clear");
  } else if (!provider) {
    $("key-status").textContent = t("key_note_new");
  } else {
    $("key-status").textContent = provider.has_api_key ? t("key_note_existing") : t("key_note_missing");
  }
  if (state.formDirty) setEditorStatus(t("unsaved_changes"), "warning");
  else setEditorStatus(provider ? t("provider_selected_hint") : t("profile_fill_hint"));
}

function loadProviderIntoForm(providerId) {
  const provider = state.providers.find((item) => item.id === providerId);
  if (!provider) return;
  state.formDirty = false;
  state.editingProviderId = provider.id;
  state.editingHasKey = Boolean(provider.has_api_key);
  state.clearKeyOnSave = false;
  $("provider-name").value = provider.name || "";
  $("provider-url").value = provider.base_url || "";
  $("provider-model").value = provider.model || "";
  $("provider-key").value = "";
  $("provider-key").type = "password";
  $("toggle-key-visibility").textContent = "◉";
  $("system-prompt").value = provider.system_prompt || "";
  $("ask-write").checked = provider.ask_before_write !== false;
  $("clear-api-key").classList.remove("key-cleared");
  $("activate-provider").disabled = false;
  renderProviderList();
  refreshProviderEditorCopy();
}

function createProviderDraft(focusName = true) {
  if (state.formDirty && !window.confirm(t("discard_new_confirm"))) return;
  state.formDirty = false;
  state.editingProviderId = null;
  state.editingHasKey = false;
  state.clearKeyOnSave = false;
  $("provider-name").value = "";
  $("provider-url").value = "https://openrouter.ai/api/v1";
  $("provider-model").value = "";
  $("provider-key").value = "";
  $("provider-key").type = "password";
  $("toggle-key-visibility").textContent = "◉";
  $("system-prompt").value = "";
  $("ask-write").checked = true;
  $("clear-api-key").classList.remove("key-cleared");
  renderProviderList();
  refreshProviderEditorCopy();
  if (focusName) $("provider-name").focus();
}

function readProviderForm() {
  return {
    id: state.editingProviderId || "",
    name: $("provider-name").value.trim(),
    base_url: $("provider-url").value.trim(),
    model: $("provider-model").value.trim(),
    api_key: $("provider-key").value,
    clear_api_key: state.clearKeyOnSave,
    system_prompt: $("system-prompt").value,
    ask_before_write: $("ask-write").checked
  };
}

async function saveProvider(makeActive = false) {
  if (!window.pywebview || !window.pywebview.api) {
    toast(t("err_app_not_running"), "error");
    return false;
  }
  const payload = readProviderForm();
  $("save-provider").disabled = true;
  $("activate-provider").disabled = true;
  setEditorStatus(t("saving_profile"));
  try {
    const result = await window.pywebview.api.save_provider_profile(payload);
    if (!result.ok) throw new Error(result.error || t("err_provider_save"));
    state.providers = result.providers || [];
    state.formDirty = false;
    state.editingProviderId = result.provider.id;
    state.clearKeyOnSave = false;
    state.editingHasKey = Boolean(result.provider.has_api_key);
    if (makeActive) {
      const activeResult = await window.pywebview.api.set_active_provider(state.editingProviderId);
      if (!activeResult.ok) throw new Error(activeResult.error || t("err_activate"));
      state.activeProviderId = activeResult.active_provider_id;
      state.providers = state.providers.map((provider) =>
        provider.id === state.activeProviderId ? { ...provider, ...activeResult.provider } : provider
      );
    } else {
      state.activeProviderId = result.active_provider_id || state.activeProviderId;
    }
    const saved = state.providers.find((provider) => provider.id === state.editingProviderId);
    if (saved) loadProviderIntoForm(saved.id);
    renderProviderList();
    updateModelChip();
    setEditorStatus(t(makeActive ? "profile_active_status" : "profile_saved_status"), "success");
    toast(t(makeActive ? "toast_provider_activated" : "toast_provider_saved"));
    return true;
  } catch (error) {
    const message = localizedError(error.message || String(error));
    setEditorStatus(message, "error");
    toast(message, "error");
    return false;
  } finally {
    $("save-provider").disabled = false;
    $("activate-provider").disabled = Boolean(activeProvider() && state.editingProviderId === state.activeProviderId);
  }
}

async function activateProvider() {
  await saveProvider(true);
}

async function deleteProvider() {
  if (!state.editingProviderId) return;
  const provider = state.providers.find((item) => item.id === state.editingProviderId);
  if (!provider) return;
  if (!window.confirm(t("profile_delete_confirm", { name: provider.name }))) return;
  $("delete-provider").disabled = true;
  try {
    const result = await window.pywebview.api.delete_provider_profile(provider.id);
    if (!result.ok) throw new Error(result.error || t("err_provider_delete"));
    state.providers = result.providers || [];
    state.formDirty = false;
    state.activeProviderId = result.active_provider_id || "";
    updateModelChip();
    if (state.providers.some((item) => item.id === state.activeProviderId)) {
      loadProviderIntoForm(state.activeProviderId);
    } else if (state.providers.length) {
      loadProviderIntoForm(state.providers[0].id);
    } else {
      createProviderDraft(false);
    }
    renderProviderList();
    toast(t("toast_provider_deleted"));
  } catch (error) {
    toast(localizedError(error.message || String(error)), "error");
  } finally {
    $("delete-provider").disabled = false;
  }
}

function populateProviders(data) {
  state.providers = data.providers || [];
  state.activeProviderId = data.active_provider_id || "";
  updateModelChip();
  renderProviderList();
  const initialId = state.providers.some((provider) => provider.id === state.activeProviderId)
    ? state.activeProviderId : (state.providers[0]?.id || "");
  if (initialId) loadProviderIntoForm(initialId);
  else createProviderDraft();
}

async function bootstrap() {
  if (state.bootstrapped || !window.pywebview || !window.pywebview.api) {
    if (!window.pywebview || !window.pywebview.api) $("workspace-path").textContent = t("bridge_unavailable");
    return;
  }
  state.bootstrapped = true;
  try {
    const data = await window.pywebview.api.get_bootstrap_data();
    $("workspace-path").textContent = data.workspace.path;
    state.uiSettings = data.ui_settings || { language: "ru", accent_color: "green" };
    applyAccent(state.uiSettings.accent_color || "green");
    await loadLanguage(state.uiSettings.language || "ru");
    populateProviders(data);
    addActivity(t("workspace_ready"), t("skills_available", { count: (data.skills || []).length }) + "\n" + t("shell_unavailable"));
    if (!state.activeProviderId) {
      showView("settings");
      toast(t("settings_provider_add_first"));
    }
  } catch (error) {
    state.bootstrapped = false;
    toast(t("bootstrap_error", { error: error.message || error }), "error");
  }
}

$("nav-chat").addEventListener("click", () => showView("chat"));
$("nav-settings").addEventListener("click", () => showView("settings"));
$("open-settings").addEventListener("click", () => showView("settings"));
$("model-chip").addEventListener("click", () => showView("settings"));
$("add-provider").addEventListener("click", createProviderDraft);
$("save-provider").addEventListener("click", () => saveProvider(false));
$("activate-provider").addEventListener("click", activateProvider);
$("delete-provider").addEventListener("click", deleteProvider);
["provider-name", "provider-url", "provider-model", "provider-key", "system-prompt"].forEach((id) => {
  $(id).addEventListener("input", () => {
    state.formDirty = true;
    setEditorStatus(t("unsaved_changes"), "warning");
  });
});
$("ask-write").addEventListener("change", () => {
  state.formDirty = true;
  setEditorStatus(t("unsaved_changes"), "warning");
});
$("clear-api-key").addEventListener("click", () => {
  $("provider-key").value = "";
  state.clearKeyOnSave = true;
  $("clear-api-key").classList.add("key-cleared");
  state.formDirty = true;
  $("key-status").textContent = t("key_note_clear");
  setEditorStatus(t("unsaved_changes"), "warning");
});
$("toggle-key-visibility").addEventListener("click", () => {
  const input = $("provider-key");
  input.type = input.type === "password" ? "text" : "password";
  $("toggle-key-visibility").textContent = input.type === "password" ? "◉" : "◎";
});
$("language-select").addEventListener("change", async (event) => {
  const previous = state.language;
  try {
    await loadLanguage(event.target.value);
    await persistUiSettings({ language: state.language });
    toast(t("language_saved"));
  } catch (error) {
    await loadLanguage(previous).catch(() => {});
    toast(localizedError(error.message || String(error)), "error");
  }
});
document.querySelectorAll("[data-accent-choice]").forEach((button) => {
  button.addEventListener("click", async () => {
    const previous = state.accentColor;
    applyAccent(button.dataset.accentChoice);
    try {
      await persistUiSettings({ accent_color: state.accentColor });
      toast(t("accent_saved"));
    } catch (error) {
      applyAccent(previous);
      toast(localizedError(error.message || String(error)), "error");
    }
  });
});
$("send-button").addEventListener("click", () => sendMessage());
$("message-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});
$("message-input").addEventListener("input", (event) => {
  event.target.style.height = "auto";
  event.target.style.height = Math.min(event.target.scrollHeight, 160) + "px";
});
document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    $("message-input").value = button.dataset.prompt;
    $("message-input").focus();
    $("message-input").dispatchEvent(new Event("input"));
  });
});
window.addEventListener("pywebviewready", bootstrap);
if (window.pywebview && window.pywebview.api) bootstrap();
