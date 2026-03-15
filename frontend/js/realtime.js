import { emitChefState } from "./chef.js";
import { icons } from "./icons.js";

let _recognition = null;
let _listening = false;
let _supported = false;
let _resumeAfterSpeech = false;
let _shouldKeepListening = true;
let _speechBlocked = false;
let _holdAutoListen = false;

function el(id) { return document.getElementById(id); }

export function isRealtimeActive() {
  return false;
}

function setButtonState() {
  const button = el("btn-mic-toggle");
  const iconEl = button?.querySelector(".icon-button");
  if (!button || !iconEl) return;

  button.classList.toggle("active", _listening);
  button.setAttribute("aria-pressed", _listening ? "true" : "false");
  button.setAttribute("title", _listening ? "Stop voice input" : "Start voice input");
  button.setAttribute("aria-label", _listening ? "Stop voice input" : "Start voice input");
  iconEl.innerHTML = _listening ? icons.micActive : icons.mic;
}

function appendRealtimeError(message) {
  const chat = el("chat-messages");
  if (!chat) return;
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble bubble-bot";
  bubble.textContent = message;
  chat.appendChild(bubble);
  chat.scrollTop = chat.scrollHeight;
}

function stopListening({ resumeAfterSpeech = false } = {}) {
  _resumeAfterSpeech = resumeAfterSpeech;
  if (_recognition && _listening) {
    if (resumeAfterSpeech) {
      _recognition.abort();
    } else {
      _recognition.stop();
    }
  }
  _listening = false;
  setButtonState();
}

function startListening() {
  if (_speechBlocked) return;
  if (!_supported || !_recognition) {
    appendRealtimeError("Voice input is not available in this browser.");
    emitChefState("thinking", "Voice input is not available here.", 1800);
    return;
  }

  try {
    _resumeAfterSpeech = false;
    _recognition.start();
    _listening = true;
    setButtonState();
    emitChefState("thinking", "Listening.", 1200);
  } catch (error) {
    console.warn("Speech recognition start error:", error);
  }
}

function toggleListening() {
  if (_listening) {
    _shouldKeepListening = false;
    stopListening();
    emitChefState("idle", "Ready when you are.", 1200);
    return;
  }
  _shouldKeepListening = true;
  startListening();
}

function initRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  _supported = Boolean(Recognition);
  setButtonState();

  if (!_supported) return;

  _recognition = new Recognition();
  _recognition.continuous = true;
  _recognition.interimResults = true;
  _recognition.lang = "en-US";

  _recognition.onresult = (event) => {
    if (_speechBlocked) {
      const input = el("chat-input");
      if (input) input.value = "";
      return;
    }

    let finalTranscript = "";
    let interimTranscript = "";

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const transcript = event.results[i][0]?.transcript?.trim() || "";
      if (!transcript) continue;
      if (event.results[i].isFinal) finalTranscript += `${transcript} `;
      else interimTranscript += `${transcript} `;
    }

    const input = el("chat-input");
    if (input && interimTranscript.trim()) {
      input.value = interimTranscript.trim();
    }

    const text = finalTranscript.trim();
    if (text) {
      if (input) input.value = "";
      document.dispatchEvent(new CustomEvent("voiceCommand", { detail: { text } }));
    }
  };

  _recognition.onerror = (event) => {
    console.warn("Speech recognition error:", event.error);
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      appendRealtimeError("Microphone access is blocked. Allow microphone access to use voice input.");
      _resumeAfterSpeech = false;
    } else if (event.error === "audio-capture") {
      appendRealtimeError("I couldn't find a working microphone on this device.");
      _resumeAfterSpeech = false;
    }
    emitChefState("thinking", "I couldn't hear that clearly.", 1800);
  };

  _recognition.onend = () => {
    const shouldResume = _resumeAfterSpeech;
    _resumeAfterSpeech = false;
    _listening = false;
    setButtonState();
    if ((shouldResume || _shouldKeepListening) && !_speechBlocked) {
      startListening();
    }
  };
}

document.addEventListener("DOMContentLoaded", () => {
  initRecognition();

  el("btn-mic-toggle")?.addEventListener("click", toggleListening);

  if (_supported) {
    window.setTimeout(() => {
      if (!_listening && _shouldKeepListening && !_speechBlocked) {
        startListening();
      }
    }, 250);
  }

  document.addEventListener("ttsSpeaking", (event) => {
    const speaking = Boolean(event.detail?.speaking);
    _speechBlocked = speaking;
    if (speaking) {
      _holdAutoListen = false;  // response TTS started — resume normal auto-listen flow
      if (_listening) stopListening({ resumeAfterSpeech: true });
    } else if (_shouldKeepListening && !_listening && !_holdAutoListen) {
      startListening();
    }
  });
});

export function stopRealtimeSession() {
  _shouldKeepListening = false;
  stopListening();
}

export function enableAutoListen() {
  _shouldKeepListening = true;
  _holdAutoListen = false;
  // Start immediately if TTS isn't currently speaking; otherwise the
  // ttsSpeaking listener will auto-start once TTS finishes.
  if (!_speechBlocked && !_listening) {
    startListening();
  }
}

export function holdAutoListen() {
  _holdAutoListen = true;
}
