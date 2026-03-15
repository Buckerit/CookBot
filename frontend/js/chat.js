// chat.js — WebSocket chat + step management

import { speak, stopSpeaking } from "./tts.js";
import { disableVoiceInput, holdAutoListen, stopRealtimeSession } from "./realtime.js";
import {
  addTime,
  dismissTimer,
  hasActiveTimer,
  hideTimerWidget,
  parseTimerCommand,
  pauseTimer,
  resetTimer,
  resumeTimer,
  showTimerWidget,
  startTimer,
  subtractTime,
} from "./timer.js";
import { highlightStep } from "./recipe.js";
import { emitChefState } from "./chef.js";
import { icon } from "./icons.js";

let _ws = null;
let _sessionId = null;
let _recipe = null;
let _pendingTimer = null;
let _eventQueue = Promise.resolve();
const _ACTIVE_SESSION_KEY = "cookassist:activeSession";

const _READY_FOR_TIMER = [
  "ready",
  "i'm ready",
  "im ready",
  "start timer",
  "start the timer",
  "timer",
  "go ahead",
  "go",
  "yes",
  "it is in",
  "it's in",
  "its in",
];

const _END_SESSION_PATTERNS = [
  /\b(stop|end|finish|terminate|close)\b.*\b(cooking|session)\b/i,
  /\b(we are done|we're done)\b.*\b(cooking|session)\b/i,
];

const _GOODBYE_PATTERNS = [
  /\b(thank you|thanks)\b.*\b(help|helping|assistance|support)?\b/i,
  /\b(goodbye|bye|see you|talk to you later|catch you later)\b/i,
  /\b(that is all|that's all|all done|im done|i'm done)\b/i,
];

function el(id) { return document.getElementById(id); }
function setInputLocked(_locked) {
  // Input stays enabled so users can type/send while TTS is playing
}
function persistActiveSession() {
  if (!_sessionId || !_recipe?.id) return;
  localStorage.setItem(_ACTIVE_SESSION_KEY, JSON.stringify({
    sessionId: _sessionId,
    recipeId: _recipe.id,
  }));
}

function clearPersistedActiveSession() {
  localStorage.removeItem(_ACTIVE_SESSION_KEY);
}

export function getPersistedActiveSession() {
  try {
    return JSON.parse(localStorage.getItem(_ACTIVE_SESSION_KEY) || "null");
  } catch (error) {
    clearPersistedActiveSession();
    return null;
  }
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function appendBubble(text, role, asHtml = false) {
  const msgs = el("chat-messages");
  const div = document.createElement("div");
  div.className = `chat-bubble bubble-${role}`;
  if (asHtml) {
    div.innerHTML = text;
  } else {
    div.textContent = text;
  }
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const parts = [];
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (secs && !hours) parts.push(`${secs} second${secs === 1 ? "" : "s"}`);
  return parts.join(" ");
}

function timerPrompt(_instruction, durationSeconds) {
  const duration = formatDuration(durationSeconds);
  return `When you're ready, say "ready" or "start timer" and I'll start the ${duration} timer.`;
}

function normalize(text) {
  return text.trim().toLowerCase().replace(/[!?.,]/g, "");
}

function isTimerReadyIntent(text) {
  const normalized = normalize(text);
  return _READY_FOR_TIMER.some((phrase) => normalized === phrase || normalized.includes(phrase));
}

function isSessionEndIntent(text) {
  return _END_SESSION_PATTERNS.some((pattern) => pattern.test(text.trim()));
}

function isGoodbyeIntent(text) {
  return _GOODBYE_PATTERNS.some((pattern) => pattern.test(text.trim()));
}

function handleGoodbye(text) {
  appendBubble(text, "user");
  disableVoiceInput();
  const reply = "You're welcome! Your cooking session will be right here whenever you want to keep going!";
  appendBubble(reply, "bot");
  emitChefState("idle", "I'll stay quiet until you need me again.", 1800);
  void speak(reply);
}

function maybeStartPendingTimer(text) {
  if (!_pendingTimer || !isTimerReadyIntent(text)) return false;

  appendBubble(text, "user");
  startTimer(_pendingTimer.seconds, _pendingTimer.instruction);
  emitChefState("loading", "Timer is live. I'll keep an eye on it.", 2200);

  const reply = `Starting your ${formatDuration(_pendingTimer.seconds)} timer now.`;
  appendBubble(reply, "bot");
  speak(reply);

  _pendingTimer = null;
  return true;
}

function timerReply(message, chefState = "loading") {
  appendBubble(message, "bot");
  emitChefState(chefState, message, 1800);
  void speak(message);
}

function maybeHandleTimerCommand(text) {
  const command = parseTimerCommand(text);
  if (!command) return false;

  appendBubble(text, "user");

  if (command.type === "start") {
    startTimer(command.seconds, "Manual timer");
    timerReply(`Starting a ${formatDuration(command.seconds)} timer now.`);
    return true;
  }

  if (!hasActiveTimer()) {
    timerReply("There isn't an active timer right now.", "thinking");
    return true;
  }

  if (command.type === "pause") {
    timerReply(pauseTimer() ? "Pausing the timer." : "The timer is already paused.", "thinking");
    return true;
  }

  if (command.type === "resume") {
    timerReply(resumeTimer() ? "Resuming the timer." : "The timer is already running.", "loading");
    return true;
  }

  if (command.type === "dismiss") {
    dismissTimer();
    timerReply("Okay, I cleared the timer.", "idle");
    return true;
  }

  if (command.type === "reset") {
    timerReply(resetTimer() ? "Resetting the timer." : "I couldn't reset that timer.", "loading");
    return true;
  }

  if (command.type === "add") {
    timerReply(addTime(command.seconds) ? `Added ${formatDuration(command.seconds)} to the timer.` : "I couldn't update the timer.", "loading");
    return true;
  }

  if (command.type === "subtract") {
    timerReply(subtractTime(command.seconds) ? `Taking off ${formatDuration(command.seconds)} from the timer.` : "I couldn't update the timer.", "thinking");
    return true;
  }

  return false;
}

function updateStepUI(payload) {
  const { step_index, step_number, total_steps, instruction, tips = [], ingredients_used = [], duration_seconds, image_url, is_completion = false } = payload;

  // Progress bar
  el("step-label").textContent = is_completion ? "All done!" : `Step ${step_number} of ${total_steps}`;
  el("progress-fill").style.width = `${(step_number / total_steps) * 100}%`;
  el("step-card")?.classList.toggle("step-completion", is_completion);

  // Step card
  el("step-instruction").textContent = instruction;

  const tipsEl = el("step-tips");
  tipsEl.innerHTML = tips.length ? tips.map(t => `<span>${esc(t)}</span>`).join("<br>") : "";

  const ingEl = el("step-ingredients");
  ingEl.innerHTML = ingredients_used.map(i => `<span class="ingredient-chip">${esc(i)}</span>`).join("");

  // Step image
  const imgEl = el("step-image");
  if (imgEl) {
    if (image_url) {
      imgEl.src = image_url;
      imgEl.classList.remove("hidden");
    } else {
      imgEl.classList.add("hidden");
    }
  }

  // Sidebar highlight
  highlightStep(step_index);
  document.dispatchEvent(new CustomEvent("cookingStateUpdated", {
    detail: {
      recipe: _recipe,
      step_index,
      step_number,
      total_steps,
      instruction,
      tips,
      ingredients_used,
      duration_seconds,
    },
  }));
}

async function handleEvent(event) {
  const { type, payload } = event;

  if (type === "step_change") {
    _pendingTimer = null;
    updateStepUI(payload);
    emitChefState("talking", "Talking through the step.", 0, { overrideLock: true });
    await speak(payload.instruction);
    if (payload.spoken_follow_up) {
      appendBubble(payload.spoken_follow_up, "bot");
      emitChefState("talking", "Talking through the step.", 0, { overrideLock: true });
      await speak(payload.spoken_follow_up);
    }
    if (payload.duration_seconds) {
      _pendingTimer = {
        seconds: payload.duration_seconds,
        instruction: payload.instruction,
      };
      const prompt = timerPrompt(payload.instruction, payload.duration_seconds);
      appendBubble(prompt, "bot");
      emitChefState("thinking", "I can start the timer when you say ready.", 2200);
      await speak(prompt);
    }
  } else if (type === "bot_message") {
    appendBubble(payload.content, "bot");
    await speak(payload.content);
  } else if (type === "timer_start") {
    _pendingTimer = {
      seconds: payload.duration_seconds,
      instruction: el("step-instruction")?.textContent || "",
    };
  } else if (type === "error") {
    appendBubble(`${icon("warning")} ${esc(payload.message)}`, "bot", true);
    emitChefState("thinking", "Something went wrong there.", 1800);
  }
}

function emitCookingSessionState(active) {
  document.dispatchEvent(new CustomEvent("cookingSessionStateChanged", {
    detail: {
      active,
      recipeId: active ? _recipe?.id ?? null : null,
      sessionId: active ? _sessionId : null,
    },
  }));
}

export async function startCookingSession(recipe, sessionId) {
  _recipe = recipe;
  _sessionId = sessionId;
  _pendingTimer = null;
  _eventQueue = Promise.resolve();  // clear any pending events from previous session
  persistActiveSession();

  // Show chat UI
  el("chat-empty").classList.add("hidden");
  el("chat-active").classList.remove("hidden");
  el("chat-messages").innerHTML = "";
  el("timer-widget").classList.add("hidden");

  // Reset step card to blank state before WS connects
  el("step-label").textContent = "Step 1 of ?";
  el("progress-fill").style.width = "0%";
  el("step-instruction").textContent = "—";
  el("step-tips").innerHTML = "";
  el("step-ingredients").innerHTML = "";
  el("step-image")?.classList.add("hidden");
  emitCookingSessionState(true);

  // Connect WebSocket
  if (_ws) { _ws.close(); }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  _ws = new WebSocket(`${proto}://${location.host}/ws/chat/${sessionId}`);

  _ws.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      _eventQueue = _eventQueue
        .then(() => handleEvent(event))
        .catch((err) => {
          console.error("WS event handling error:", err);
        });
    } catch (err) {
      console.error("WS parse error:", err);
    }
  };

  _ws.onerror = (e) => {
    appendBubble("Connection error. Please refresh.", "bot");
  };

  _ws.onclose = () => {
    console.log("WebSocket closed");
  };
}

export function endCookingSession() {
  stopSpeaking();
  stopRealtimeSession();
  resetCookingUi();
  emitCookingSessionState(false);
}

export function clearCookingSessionPersistence() {
  clearPersistedActiveSession();
}

export function clearEventQueue() {
  _eventQueue = Promise.resolve();
}

export function resetCookingUi() {
  stopSpeaking();
  _recipe = null;
  _sessionId = null;
  _pendingTimer = null;
  if (_ws) {
    _ws.close();
    _ws = null;
  }
  clearPersistedActiveSession();
  dismissTimer();
  el("chat-messages").innerHTML = "";
  el("chat-active").classList.add("hidden");
  el("chat-empty").classList.remove("hidden");
  el("step-label").textContent = "Step 1 of ?";
  el("progress-fill").style.width = "0%";
  el("step-instruction").textContent = "—";
  el("step-tips").innerHTML = "";
  el("step-ingredients").innerHTML = "";
  el("step-image")?.classList.add("hidden");
}

export function sendMessage(text) {
  if (isGoodbyeIntent(text)) {
    handleGoodbye(text);
    return;
  }
  if (isSessionEndIntent(text)) {
    appendBubble(text, "user");
    endCookingSession();
    return;
  }
  if (maybeStartPendingTimer(text)) return;
  if (maybeHandleTimerCommand(text)) return;
  if (!_ws || _ws.readyState !== WebSocket.OPEN) {
    console.warn("WebSocket not connected");
    return;
  }
  appendBubble(text, "user");
  _ws.send(JSON.stringify({ text }));
}

// Wire up input
document.addEventListener("DOMContentLoaded", () => {
  const input = el("chat-input");
  const btn = el("btn-send");

  function submit() {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    holdAutoListen();
    stopSpeaking();
    _eventQueue = Promise.resolve();
    sendMessage(text);
  }

  btn?.addEventListener("click", submit);
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  });

  el("btn-timer-cancel")?.addEventListener("click", () => dismissTimer());
  el("btn-timer-hide")?.addEventListener("click", () => hideTimerWidget());
  el("timer-mini")?.addEventListener("click", () => showTimerWidget());
});

// Jump to step from sidebar click
document.addEventListener("jumpToStep", (e) => {
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    const stepNumber = Number(e.detail) + 1;
    _ws.send(JSON.stringify({ text: `Go to step ${stepNumber}` }));
  }
});

document.addEventListener("voiceCommand", (e) => {
  const text = e.detail?.text?.trim();
  if (text) sendMessage(text);
});

document.addEventListener("recipeSelected", (e) => {
  if (!e.detail) {
    resetCookingUi();
    emitCookingSessionState(false);
  }
});

document.addEventListener("timerDone", (e) => {
  const message = "Timer's up.";
  appendBubble(message, "bot");
  emitChefState("celebrate", "Timer's done.", 2400);
  void speak(message);
});

document.addEventListener("ttsSpeaking", (e) => {
  setInputLocked(Boolean(e.detail?.speaking));
});
