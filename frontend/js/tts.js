// tts.js — text-to-speech playback

import { icons } from "./icons.js";
import { emitChefState } from "./chef.js";
import { isRealtimeActive } from "./realtime.js";

let _enabled = true;
let _currentAudio = null;
let _audioUnlocked = false;

const _SILENT_AUDIO =
  "data:audio/mp3;base64,SUQzAwAAAAAAFlRFTkMAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//uQxAADBzQAHgAAGFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFj/+5DEAAEHNAAeAAAYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFg==";

export function isTTSEnabled() { return _enabled; }

function emitSpeechState(speaking) {
  document.dispatchEvent(new CustomEvent("ttsSpeaking", { detail: { speaking } }));
}

async function unlockAudio() {
  if (_audioUnlocked) return true;

  try {
    const audio = new Audio(_SILENT_AUDIO);
    audio.muted = true;
    await audio.play();
    audio.pause();
    _audioUnlocked = true;
  } catch (error) {
    console.warn("Audio unlock failed:", error);
  }

  return _audioUnlocked;
}

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
  if (!_enabled || !text || isRealtimeActive()) return;

  // Stop any playing audio
  if (_currentAudio) {
    _currentAudio.pause();
    _currentAudio = null;
  }

  try {
    emitChefState("talking", "Talking through the step.");
    emitSpeechState(true);
    await unlockAudio();
    const res = await fetch("/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      console.warn("TTS request failed:", res.status);
      emitSpeechState(false);
      emitChefState("idle", "Ready when you are.");
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    _currentAudio = new Audio(url);
    _currentAudio.preload = "auto";
    await new Promise((resolve) => {
      _currentAudio.onended = () => {
        URL.revokeObjectURL(url);
        emitSpeechState(false);
        emitChefState("idle", "Ready when you are.");
        resolve();
      };
      _currentAudio.onerror = () => {
        URL.revokeObjectURL(url);
        emitSpeechState(false);
        emitChefState("idle", "Ready when you are.");
        resolve();
      };
      _currentAudio.play().catch((error) => {
        console.warn("Audio playback failed:", error);
        emitSpeechState(false);
        emitChefState("idle", "Ready when you are.");
        resolve();
      });
    });
  } catch (e) {
    console.warn("TTS error:", e);
    emitSpeechState(false);
    emitChefState("idle", "Ready when you are.");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-tts-toggle")?.addEventListener("click", toggleTTS);
  const tryUnlock = () => {
    void unlockAudio();
  };
  document.addEventListener("pointerdown", tryUnlock, { once: true });
  document.addEventListener("keydown", tryUnlock, { once: true });
});
