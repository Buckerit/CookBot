// tts.js — text-to-speech playback

let _enabled = true;
let _currentAudio = null;
let _resolveSpeak = null;

export function isTTSEnabled() { return _enabled; }

export function stopTTS() {
  if (_currentAudio) {
    _currentAudio.pause();
    _currentAudio = null;
  }
  if (_resolveSpeak) {
    _resolveSpeak();
    _resolveSpeak = null;
  }
}

export function toggleTTS() {
  _enabled = !_enabled;
  document.getElementById("btn-tts-toggle").textContent = _enabled ? "🔊" : "🔇";
  if (!_enabled) stopTTS();
}

export async function speak(text) {
  if (!_enabled || !text) return;

  stopTTS(); // cancel any currently playing audio

  try {
    const res = await fetch("/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      console.warn("TTS request failed:", res.status);
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    _currentAudio = new Audio(url);

    await new Promise((resolve) => {
      _resolveSpeak = resolve;
      _currentAudio.onended = () => {
        URL.revokeObjectURL(url);
        _resolveSpeak = null;
        setTimeout(resolve, 500);
      };
      _currentAudio.onerror = () => {
        URL.revokeObjectURL(url);
        _resolveSpeak = null;
        resolve();
      };
      _currentAudio.play().catch(() => resolve());
    });
  } catch (e) {
    console.warn("TTS error:", e);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-tts-toggle")?.addEventListener("click", toggleTTS);
});
