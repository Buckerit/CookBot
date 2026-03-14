// voice.js — continuous speech-to-text via Web Speech API

let _recognition = null;
let _enabled = false;
let _sending = false;  // prevent double-sends while bot is responding
let _restartTimer = null;
let _onTranscript = null;  // stored so unlockMic can restart independently

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const INTERRUPT_PHRASES = ["next", "next step", "go back", "back", "previous", "repeat", "stop", "pause", "skip"];

function isInterrupt(text) {
  const t = text.toLowerCase().trim();
  return INTERRUPT_PHRASES.some(p => t === p || t.startsWith(p + " ") || t.endsWith(" " + p));
}

export function isVoiceSupported() {
  return !!SpeechRecognition;
}

export function isVoiceEnabled() {
  return _enabled;
}

function getMicBtn() { return document.getElementById("btn-mic"); }
function getInputEl() { return document.getElementById("chat-input"); }

function setMicState(state) {
  const btn = getMicBtn();
  if (!btn) return;
  btn.dataset.state = state;
  if (state === "listening") {
    btn.textContent = "🎙️";
    btn.classList.add("mic-active");
    btn.title = "Listening... (click to stop)";
  } else if (state === "processing") {
    btn.textContent = "⏳";
    btn.classList.remove("mic-active");
    btn.title = "Processing...";
  } else {
    btn.textContent = "🎤";
    btn.classList.remove("mic-active");
    btn.title = "Click to start voice input";
  }
}

export function lockMic() {
  // Keep mic listening during TTS so interrupt commands can be heard
  _sending = true;
  if (_restartTimer) { clearTimeout(_restartTimer); _restartTimer = null; }
  setMicState("listening");
}

export function unlockMic() {
  // Small delay for room echo to die out
  _restartTimer = setTimeout(() => {
    _sending = false;
  }, 750);
}

export function startVoice(onTranscript) {
  if (!SpeechRecognition) {
    alert("Your browser doesn't support speech recognition. Use Chrome or Edge.");
    return;
  }
  if (_enabled) return;
  _enabled = true;
  _onTranscript = onTranscript;
  _init(onTranscript);
}

export function stopVoice() {
  _enabled = false;
  if (_recognition) {
    try { _recognition.stop(); } catch (_) {}
    _recognition = null;
  }
  if (_restartTimer) { clearTimeout(_restartTimer); _restartTimer = null; }
  setMicState("off");
}

export function toggleVoice(onTranscript) {
  if (_enabled) {
    stopVoice();
  } else {
    startVoice(onTranscript);
  }
}

function _init(onTranscript) {
  if (!_enabled) return;

  _recognition = new SpeechRecognition();
  _recognition.continuous = false;       // auto-stops after silence
  _recognition.interimResults = true;    // show live transcript in input box
  _recognition.lang = "en-US";
  _recognition.maxAlternatives = 1;

  _recognition.onstart = () => {
    setMicState("listening");
  };

  _recognition.onresult = (e) => {
    let interim = "";
    let final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) {
        final += t;
      } else {
        interim += t;
      }
    }
    // Show interim in input box for feedback
    if (interim) getInputEl().value = interim;

    if (final.trim()) {
      // While bot is talking, only allow interrupt commands through
      if (_sending && !isInterrupt(final.trim())) return;
      getInputEl().value = "";
      setMicState("processing");
      onTranscript(final.trim());
    }
  };

  _recognition.onerror = (e) => {
    if (e.error === "no-speech" || e.error === "aborted") return; // normal
    if (e.error === "not-allowed") {
      alert("Microphone access denied. Please allow mic access in your browser.");
      stopVoice();
      return;
    }
    console.warn("Speech recognition error:", e.error);
  };

  _recognition.onend = () => {
    if (!_enabled) return;
    // Always restart so we can hear interrupt commands even during TTS
    _restartTimer = setTimeout(() => {
      if (_enabled) _init(onTranscript);
    }, 300);
  };

  try {
    _recognition.start();
  } catch (e) {
    console.error("Could not start recognition:", e);
  }
}
