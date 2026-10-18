const $ = (id) => document.getElementById(id);

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
  bootstrapped: false
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
  if (view !== "settings" && state.formDirty &&
      !window.confirm("Есть несохранённые изменения профиля. Перейти без сохранения?")) return;
  const settingsVisible = view === "settings";
  $("settings-view").classList.toggle("hidden", !settingsVisible);
  $("chat-view").classList.toggle("hidden", settingsVisible);
  $("nav-settings").classList.toggle("active", settingsVisible);
  $("nav-chat").classList.toggle("active", !settingsVisible);
  $("view-title").textContent = settingsVisible ? "Настройки" : (state.history.length ? "Диалог" : "Новый диалог");
  $("top-eyebrow").textContent = settingsVisible ? "CONTROL CENTER / SETTINGS" : "WORKSPACE / ONE";
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
  const name = role === "user" ? "Ты" : "Quill";
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
    '<span>Модель анализирует запрос <span class="step-label">· шаг ' + escapeHTML(step) + '</span></span>' +
    '<span class="thinking-dots" aria-label="Выполняется"><i></i><i></i><i></i></span></div>';
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
    if (!result.ok) throw new Error(result.error || "Запрос больше не активен.");
    card.classList.add("approval-resolved");
    card.querySelector(".approval-actions").innerHTML = approved
      ? '<span class="approval-result approved-result">✓ Разрешено · выполняю</span>'
      : '<span class="approval-result rejected-result">⊘ Отклонено · агент получит отказ</span>';
  } catch (error) {
    toast(error.message || String(error), "error");
    card.querySelectorAll("button").forEach((button) => { button.disabled = false; });
  }
}

function renderApproval(event) {
  const data = event.data || {};
  if (state.seenApprovals.has(data.approval_id)) return;
  state.seenApprovals.add(data.approval_id);

  const card = document.createElement("article");
  card.className = "approval-card";
  card.innerHTML = '<div class="approval-title-row"><span class="approval-icon">⚠</span>' +
    '<h3>Требуется подтверждение</h3><span class="approval-tag">ВАЖНОЕ ДЕЙСТВИЕ</span></div>' +
    '<p>' + escapeHTML(data.summary || data.tool || "Агент запросил разрешение.") + '</p>' +
    '<div class="approval-actions"><button class="approve">✓ Разрешить</button>' +
    '<button class="reject">Отклонить</button></div>';
  card.querySelector(".approve").addEventListener("click", () => resolveApproval(data.approval_id, true, card));
  card.querySelector(".reject").addEventListener("click", () => resolveApproval(data.approval_id, false, card));
  $("approval-list").appendChild(card);
  scrollToBottom();
}

function renderEvent(event) {
  const data = event.data || {};
  switch (event.type) {
    case "model.requested":
      showThinking(data.turn || 1);
      break;
    case "tool.requested":
      hideThinking();
      addActivity("Запрос инструмента · " + (data.tool || "неизвестно"), JSON.stringify(data.arguments || {}, null, 2));
      break;
    case "tool.started":
      addActivity("Выполняется · " + (data.tool || "инструмент"), JSON.stringify(data.arguments || {}, null, 2));
      break;
    case "tool.completed":
      addActivity("Готово · " + (data.tool || "инструмент"), JSON.stringify(data.result || {}, null, 2));
      break;
    case "tool.denied":
      hideThinking();
      addActivity("Действие заблокировано", data.reason || "Операция отклонена политикой безопасности.", "denied");
      break;
    case "tool.failed":
      addActivity("Ошибка инструмента · " + (data.tool || ""), data.error || "", "denied");
      break;
    case "approval.required":
      hideThinking();
      renderApproval(event);
      break;
    case "approval.expired":
      addActivity("Время подтверждения истекло", data.tool || "", "denied");
      break;
    case "assistant.message":
      hideThinking();
      addMessage("assistant", data.content || "");
      state.history.push({ role: "assistant", content: data.content || "" });
      $("token-counter").textContent = "Контекст: ≈" +
        Math.ceil(state.history.map((message) => message.content).join("\n").length / 3.6) +
        " токенов · оценка";
      break;
    case "usage.updated":
      if (data.input_tokens != null && data.output_tokens != null) {
        $("token-counter").textContent = "Последний запрос: " + data.input_tokens + " in / " + data.output_tokens + " out";
      }
      break;
    case "run.failed":
      hideThinking();
      addActivity("Не удалось завершить задачу", data.error || "Неизвестная ошибка.", "denied");
      toast(data.error || "Ошибка агента.", "error");
      break;
    case "run.completed":
      hideThinking();
      addActivity("Задача завершена");
      break;
    case "run.cancelled":
      hideThinking();
      addActivity("Задача отменена");
      break;
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
    if (!result.ok) throw new Error(result.error || "Не удалось получить состояние запуска.");
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
  if (!window.pywebview || !window.pywebview.api) {
    toast("Запусти приложение через main.py, чтобы подключить Python API.", "error");
    return;
  }
  if (!state.activeProviderId) {
    showView("settings");
    toast("Добавь и активируй провайдера в настройках.", "error");
    return;
  }

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
    if (!result.ok) throw new Error(result.error || "Не удалось запустить агента.");
    state.runId = result.run_id;
    pollRun(state.runId);
  } catch (error) {
    state.busy = false;
    $("send-button").disabled = false;
    $("send-button").textContent = "↑";
    addActivity("Не удалось запустить агента", error.message || String(error), "denied");
    toast(error.message || String(error), "error");
  }
}

function activeProvider() {
  return state.providers.find((provider) => provider.id === state.activeProviderId) || null;
}

function updateModelChip() {
  const provider = activeProvider();
  $("model-label").textContent = provider
    ? ((provider.name ? provider.name + " · " : "") + (provider.model || "модель не указана"))
    : "Модель не выбрана";
  $("model-chip").title = provider
    ? "Активно: " + provider.name + " / " + provider.model + ". Открыть настройки."
    : "Добавить провайдера в настройках";
}

function providerIcon(name) {
  const clean = String(name || "").trim();
  return clean ? escapeHTML(clean.slice(0, 1).toUpperCase()) : "◈";
}

function renderProviderList() {
  const list = $("provider-list");
  list.innerHTML = "";
  $("provider-count").textContent = String(state.providers.length);

  if (!state.providers.length) {
    const empty = document.createElement("div");
    empty.className = "provider-list-empty";
    empty.innerHTML = '<span class="empty-provider-icon">＋</span><span>Пока здесь пусто.</span><span>Создай профиль первого провайдера.</span>';
    list.appendChild(empty);
    return;
  }

  for (const provider of state.providers) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "provider-card" + (provider.id === state.editingProviderId ? " selected" : "");
    const activeLabel = provider.id === state.activeProviderId
      ? '<span class="provider-card-active">АКТИВНЫЙ</span>' : "";
    card.innerHTML = '<span class="provider-card-orb">' + providerIcon(provider.name) + '</span>' +
      '<span class="provider-card-content"><span class="provider-card-top"><span class="provider-card-name">' +
      escapeHTML(provider.name) + '</span></span><span class="provider-card-model">' +
      escapeHTML(provider.model || "Модель не указана") + '</span>' + activeLabel + '</span>';
    card.addEventListener("click", () => {
      if (state.editingProviderId === provider.id && !state.formDirty) return;
      if (state.formDirty && !window.confirm("Отбросить несохранённые изменения текущего профиля?")) return;
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
  $("provider-form-status").textContent = "PROVIDER PROFILE";
  $("provider-form-title").textContent = provider.name || "Провайдер";
  $("provider-active-badge").classList.toggle("hidden", provider.id !== state.activeProviderId);
  $("delete-provider").classList.remove("hidden");
  $("clear-api-key").classList.remove("key-cleared");
  $("key-status").textContent = provider.has_api_key
    ? "Ключ есть в памяти приложения. Оставь поле пустым, чтобы не менять его."
    : "Ключ ещё не задан для этого профиля. Он останется только в памяти приложения.";
  $("activate-provider").innerHTML = provider.id === state.activeProviderId
    ? 'Уже используется <span>✓</span>' : 'Сохранить и использовать <span>↗</span>';
  $("activate-provider").disabled = provider.id === state.activeProviderId;
  setEditorStatus("Выбран профиль. Несохранённые изменения будут применены после сохранения.");
  renderProviderList();
}

function createProviderDraft() {
  if (state.formDirty && !window.confirm("Отбросить несохранённые изменения и создать новый профиль?")) return;
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
  $("provider-form-status").textContent = "NEW PROFILE";
  $("provider-form-title").textContent = "Новый провайдер";
  $("provider-active-badge").classList.add("hidden");
  $("delete-provider").classList.add("hidden");
  $("key-status").textContent = "Ключ не будет записан на диск. Его можно добавить позже.";
  $("clear-api-key").classList.remove("key-cleared");
  $("activate-provider").innerHTML = 'Сохранить и использовать <span>↗</span>';
  $("activate-provider").disabled = false;
  setEditorStatus("Заполни endpoint и модель. Данные профиля будут сохранены локально.");
  renderProviderList();
  $("provider-name").focus();
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
    toast("Сохранять профили можно из запущенного приложения.", "error");
    return false;
  }
  const payload = readProviderForm();
  $("save-provider").disabled = true;
  $("activate-provider").disabled = true;
  setEditorStatus("Сохраняю профиль…");
  try {
    const result = await window.pywebview.api.save_provider_profile(payload);
    if (!result.ok) throw new Error(result.error || "Не удалось сохранить провайдера.");
    state.providers = result.providers || [];
    state.formDirty = false;
    state.editingProviderId = result.provider.id;
    state.clearKeyOnSave = false;
    state.editingHasKey = Boolean(result.provider.has_api_key);
    if (makeActive) {
      const activeResult = await window.pywebview.api.set_active_provider(state.editingProviderId);
      if (!activeResult.ok) throw new Error(activeResult.error || "Профиль сохранён, но не удалось активировать его.");
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
    setEditorStatus(makeActive ? "Профиль сохранён и выбран активным." : "Профиль сохранён.", "success");
    toast(makeActive ? "Провайдер сохранён и активирован." : "Профиль провайдера сохранён.");
    return true;
  } catch (error) {
    setEditorStatus(error.message || String(error), "error");
    toast(error.message || String(error), "error");
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
  if (!window.confirm("Удалить профиль «" + provider.name + "»? Его API-ключ также будет забыт.")) return;
  $("delete-provider").disabled = true;
  try {
    const result = await window.pywebview.api.delete_provider_profile(provider.id);
    if (!result.ok) throw new Error(result.error || "Не удалось удалить профиль.");
    state.providers = result.providers || [];
    state.formDirty = false;
    state.activeProviderId = result.active_provider_id || "";
    updateModelChip();
    if (state.providers.some((item) => item.id === state.activeProviderId)) {
      loadProviderIntoForm(state.activeProviderId);
    } else if (state.providers.length) {
      loadProviderIntoForm(state.providers[0].id);
    } else {
      createProviderDraft();
    }
    renderProviderList();
    toast("Профиль удалён.");
  } catch (error) {
    toast(error.message || String(error), "error");
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
    if (!window.pywebview || !window.pywebview.api) $("workspace-path").textContent = "Python bridge недоступен";
    return;
  }
  state.bootstrapped = true;
  try {
    const data = await window.pywebview.api.get_bootstrap_data();
    $("workspace-path").textContent = data.workspace.path;
    populateProviders(data);
    addActivity("Рабочая среда готова", "Навыков доступно: " + (data.skills || []).length +
      "\nЗапуск команд отключён до появления OS sandbox.");
    if (!state.activeProviderId) {
      showView("settings");
      toast("Добавь своего первого провайдера в настройках.");
    }
  } catch (error) {
    state.bootstrapped = false;
    toast("Не удалось загрузить настройки: " + (error.message || error), "error");
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
    setEditorStatus("Есть несохранённые изменения.", "warning");
  });
});
$("ask-write").addEventListener("change", () => {
  state.formDirty = true;
  setEditorStatus("Есть несохранённые изменения.", "warning");
});
$("clear-api-key").addEventListener("click", () => {
  $("provider-key").value = "";
  state.clearKeyOnSave = true;
  $("clear-api-key").classList.add("key-cleared");
  state.formDirty = true;
  $("key-status").textContent = "Ключ будет удалён из памяти приложения после сохранения профиля.";
  setEditorStatus("Есть несохранённые изменения.", "warning");
});
$("toggle-key-visibility").addEventListener("click", () => {
  const input = $("provider-key");
  input.type = input.type === "password" ? "text" : "password";
  $("toggle-key-visibility").textContent = input.type === "password" ? "◉" : "◎";
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
