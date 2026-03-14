// chat.js — WebSocket chat + step management

import { speak, stopTTS } from "./tts.js";
import { startTimer } from "./timer.js";
import { highlightStep } from "./recipe.js";
import { startVoice, stopVoice, lockMic, unlockMic, isVoiceSupported, toggleVoice } from "./voice.js";
import { initManualTimer } from "./timer.js";

let _ws = null;
let _sessionId = null;
let _recipe = null;

function el(id) { return document.getElementById(id); }

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function appendBubble(text, role) {
  const msgs = el("chat-messages");
  const div = document.createElement("div");
  div.className = `chat-bubble bubble-${role}`;
  div.textContent = text;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function updateStepUI(payload) {
  const { step_index, step_number, total_steps, instruction, tips = [], ingredients_used = [], duration_seconds } = payload;

  el("step-label").textContent = `Step ${step_number} of ${total_steps}`;
  el("progress-fill").style.width = `${(step_number / total_steps) * 100}%`;
  el("step-instruction").textContent = instruction;

  const tipsEl = el("step-tips");
  tipsEl.innerHTML = tips.length ? tips.map(t => `<span>${esc(t)}</span>`).join("<br>") : "";

  const ingEl = el("step-ingredients");
  ingEl.innerHTML = ingredients_used.map(i => `<span class="ingredient-chip">${esc(i)}</span>`).join("");

  highlightStep(step_index);
}

async function handleEvent(event) {
  const { type, payload } = event;

  if (type === "step_change") {
    updateStepUI(payload);
    lockMic();
    await speak(payload.instruction);
    unlockMic();
    if (payload.duration_seconds) startTimer(payload.duration_seconds);
  } else if (type === "bot_message") {
    appendBubble(payload.content, "bot");
    lockMic();
    await speak(payload.content);
    unlockMic();
  } else if (type === "timer_start") {
    startTimer(payload.duration_seconds, payload.label || "");
  } else if (type === "error") {
    appendBubble(`⚠️ ${payload.message}`, "bot");
    unlockMic();
  }
}

export async function startCookingSession(recipe, sessionId) {
  _recipe = recipe;
  _sessionId = sessionId;

  el("chat-empty").classList.add("hidden");
  el("chat-active").classList.remove("hidden");
  el("chat-messages").innerHTML = "";

  // Show mic button if voice is supported
  const micBtn = el("btn-mic");
  if (micBtn) {
    micBtn.classList.toggle("hidden", !isVoiceSupported());
  }

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

  _ws.onerror = () => appendBubble("Connection error. Please refresh.", "bot");
  _ws.onclose = () => {
    stopVoice();
    console.log("WebSocket closed");
  };

  // Auto-start voice input when session begins
  if (isVoiceSupported()) {
    // Small delay so the welcome step TTS doesn't get cut off by mic starting
    setTimeout(() => startVoice(sendMessage), 1500);
  }
}

export function sendMessage(text) {
  stopTTS(); // cut off any playing TTS immediately
  if (!_ws || _ws.readyState !== WebSocket.OPEN) {
    console.warn("WebSocket not connected");
    return;
  }
  appendBubble(text, "user");
  _ws.send(JSON.stringify({ text }));
}

// Wire up text input
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

  // Mic toggle button
  el("btn-mic")?.addEventListener("click", () => toggleVoice(sendMessage));

  // Manual timer
  initManualTimer();
});
