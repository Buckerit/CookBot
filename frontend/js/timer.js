// timer.js — countdown timer widget

let _totalSeconds = 0;
let _remaining = 0;
let _intervalId = null;
let _paused = false;
let _lastTick = null;
let _activeStepText = "";
let _isRunning = false;

function el(id) { return document.getElementById(id); }
function activeContainer() { return document.getElementById("chat-active"); }

function format(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function updateDisplay() {
  el("timer-display").textContent = format(Math.max(0, Math.ceil(_remaining)));
}

function setStepLabel(text) {
  el("timer-step").textContent = text || "Waiting for a timed step";
}

function setPauseLabel() {
  el("btn-timer-pause").textContent = _paused ? "Resume" : "Pause";
}

function syncButtons() {
  const hasTimer = _totalSeconds > 0;
  el("btn-timer-pause").classList.toggle("hidden", !hasTimer || !_isRunning);
  el("btn-timer-reset").classList.toggle("hidden", !hasTimer);
  el("btn-timer-dismiss").classList.toggle("hidden", !hasTimer);
}

function applyTimerMode() {
  activeContainer()?.classList.toggle("timer-live", _isRunning);
}

function tick() {
  const now = performance.now();
  if (_lastTick !== null && !_paused) {
    const delta = (now - _lastTick) / 1000;
    _remaining -= delta;
  }
  _lastTick = now;

  updateDisplay();

  if (_remaining <= 0) {
    stopTimer();
    el("timer-display").textContent = "Done!";
    setStepLabel(`Timer finished: ${_activeStepText || "current step"}`);
    document.dispatchEvent(new CustomEvent("timerDone", { detail: { stepText: _activeStepText } }));
    syncButtons();
    applyTimerMode();
  }
}

export function startTimer(seconds, stepText = "") {
  if (_intervalId) clearInterval(_intervalId);
  _totalSeconds = seconds;
  _remaining = seconds;
  _paused = false;
  _activeStepText = stepText;
  _isRunning = false;
  el("timer-widget").classList.remove("hidden");
  setStepLabel(stepText || "Current timed step");
  setPauseLabel();
  updateDisplay();
  _isRunning = true;
  _lastTick = performance.now();
  setPauseLabel();
  syncButtons();
  applyTimerMode();
  _intervalId = setInterval(tick, 250);
}

export function stopTimer() {
  if (_intervalId) { clearInterval(_intervalId); _intervalId = null; }
  _isRunning = false;
  _lastTick = null;
}

export function dismissTimer() {
  stopTimer();
  _totalSeconds = 0;
  _remaining = 0;
  _paused = false;
  _activeStepText = "";
  setPauseLabel();
  setStepLabel("");
  updateDisplay();
  syncButtons();
  applyTimerMode();
  el("timer-widget").classList.add("hidden");
}

export function pauseTimer() {
  if (!_totalSeconds || !_isRunning) return;
  _paused = !_paused;
  setPauseLabel();
  if (!_paused) _lastTick = performance.now();
}

export function resetTimer() {
  if (!_totalSeconds) return;
  _remaining = _totalSeconds;
  _paused = false;
  _isRunning = true;
  setPauseLabel();
  setStepLabel(_activeStepText || "Current timed step");
  updateDisplay();
  _lastTick = performance.now();
  if (_intervalId) clearInterval(_intervalId);
  _intervalId = setInterval(tick, 250);
  syncButtons();
  applyTimerMode();
}

// Recalc on tab focus to avoid drift
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && _intervalId && !_paused) {
    _lastTick = performance.now();
  }
});

// Wire up buttons
document.addEventListener("DOMContentLoaded", () => {
  el("btn-timer-pause")?.addEventListener("click", pauseTimer);
  el("btn-timer-reset")?.addEventListener("click", resetTimer);
  el("btn-timer-dismiss")?.addEventListener("click", dismissTimer);
});
