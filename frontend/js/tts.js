// tts.js — text-to-speech playback

import { icons } from "./icons.js";
import { emitChefState } from "./chef.js";

let _enabled = true;
let _currentAudio = null;

export function isTTSEnabled() { return _enabled; }

export function toggleTTS() {
  _enabled = !_enabled;
  const iconEl = document.querySelector("#btn-tts-toggle .icon-button");
  if (iconEl) iconEl.innerHTML = _enabled ? icons.speaker : icons.mute;
  if (!_enabled && _currentAudio) {
    _currentAudio.pause();
    _currentAudio = null;
  }
  emitChefState("idle", _enabled ? "Voice guidance is on." : "Voice guidance is muted.", 1400);
}

export async function speak(text) {
  if (!_enabled || !text) return;

  // Stop any playing audio
  if (_currentAudio) {
    _currentAudio.pause();
    _currentAudio = null;
  }

  try {
    emitChefState("talking", "Talking through the step.");
    const res = await fetch("/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      console.warn("TTS request failed:", res.status);
      emitChefState("idle", "Ready when you are.");
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    _currentAudio = new Audio(url);
    _currentAudio.onended = () => {
      URL.revokeObjectURL(url);
      emitChefState("idle", "Ready when you are.");
    };
    await _currentAudio.play();
  } catch (e) {
    console.warn("TTS error:", e);
    emitChefState("idle", "Ready when you are.");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-tts-toggle")?.addEventListener("click", toggleTTS);
});
