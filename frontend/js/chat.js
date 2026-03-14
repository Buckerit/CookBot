// chat.js — WebSocket chat + step management

import { speak } from "./tts.js";
import { startTimer } from "./timer.js";
import { highlightStep } from "./recipe.js";
import { emitChefState } from "./chef.js";
import { icon } from "./icons.js";

let _ws = null;
let _sessionId = null;
let _recipe = null;
let _pendingTimer = null;

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

function el(id) { return document.getElementById(id); }

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

function timerPrompt(instruction, durationSeconds) {
  const duration = formatDuration(durationSeconds);
  return `The next step is: ${instruction} When you're ready, say "ready" or "start timer" and I'll start the ${duration} timer.`;
}

function normalize(text) {
  return text.trim().toLowerCase().replace(/[!?.,]/g, "");
}

function isTimerReadyIntent(text) {
  const normalized = normalize(text);
  return _READY_FOR_TIMER.some((phrase) => normalized === phrase || normalized.includes(phrase));
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

function updateStepUI(payload) {
  const { step_index, step_number, total_steps, instruction, tips = [], ingredients_used = [], duration_seconds } = payload;

  // Progress bar
  el("step-label").textContent = `Step ${step_number} of ${total_steps}`;
  el("progress-fill").style.width = `${(step_number / total_steps) * 100}%`;

  // Step card
  el("step-instruction").textContent = instruction;

  const tipsEl = el("step-tips");
  tipsEl.innerHTML = tips.length ? tips.map(t => `<span>${esc(t)}</span>`).join("<br>") : "";

  const ingEl = el("step-ingredients");
  ingEl.innerHTML = ingredients_used.map(i => `<span class="ingredient-chip">${esc(i)}</span>`).join("");

  // Sidebar highlight
  highlightStep(step_index);
}

function handleEvent(event) {
  const { type, payload } = event;

  if (type === "step_change") {
    _pendingTimer = null;
    updateStepUI(payload);
    speak(payload.instruction);
    if (payload.duration_seconds) {
      _pendingTimer = {
        seconds: payload.duration_seconds,
        instruction: payload.instruction,
      };
      const prompt = timerPrompt(payload.instruction, payload.duration_seconds);
      appendBubble(prompt, "bot");
      emitChefState("thinking", "I can start the timer when you say ready.", 2200);
      speak(prompt);
    }
  } else if (type === "bot_message") {
    appendBubble(payload.content, "bot");
    speak(payload.content);
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

export async function startCookingSession(recipe, sessionId) {
  _recipe = recipe;
  _sessionId = sessionId;

  // Show chat UI
  el("chat-empty").classList.add("hidden");
  el("chat-active").classList.remove("hidden");
  el("chat-messages").innerHTML = "";
  el("timer-widget").classList.add("hidden");

  // Connect WebSocket
  if (_ws) { _ws.close(); }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  _ws = new WebSocket(`${proto}://${location.host}/ws/chat/${sessionId}`);

  _ws.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      handleEvent(event);
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

export function sendMessage(text) {
  if (maybeStartPendingTimer(text)) return;
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
    sendMessage(text);
  }

  btn?.addEventListener("click", submit);
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  });
});

// Jump to step from sidebar click
document.addEventListener("jumpToStep", (e) => {
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    // We can't directly set step_index via WS message without backend support.
    // For now, send "next" repeatedly or just send the step request as a message.
    // Simple approach: tell the bot to go to that step via text.
    // TODO: add a dedicated WS message type for step jump
  }
});

document.addEventListener("timerDone", (e) => {
  const stepText = e.detail?.stepText ? ` for "${e.detail.stepText}"` : "";
  const message = `Your timer is done${stepText}.`;
  appendBubble(message, "bot");
  emitChefState("celebrate", "Timer's done.", 2400);
  speak(message);
});
