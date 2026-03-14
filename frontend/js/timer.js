// timer.js — voice-first countdown timer

let _totalSeconds = 0;
let _remaining = 0;
let _intervalId = null;
let _paused = false;
let _lastTick = null;
let _activeStepText = "";
let _isRunning = false;
let _dismissTimeoutId = null;

const _CREATE_TIMER_PATTERN = /\b(?:set|start|create)\s+(?:a\s+)?timer\s+(?:for\s+)?(.+)/i;
const _BARE_TIMER_PATTERN = /\btimer\s+(?:for\s+)?(.+)/i;
const _PAUSE_TIMER_PATTERN = /\b(?:pause|hold)\s+(?:the\s+)?timer\b/i;
const _RESUME_TIMER_PATTERN = /\b(?:resume|continue|restart)\s+(?:the\s+)?timer\b/i;
const _STOP_TIMER_PATTERN = /\b(?:stop|cancel|end|clear|remove|dismiss)\s+(?:the\s+)?timer\b/i;
const _DONE_TIMER_PATTERN = /\b(?:done|finished|all done|its done|it's done|timer done|i am done|i'm done|im done|that is done|thats done|that's done|we are done|we're done|were done)\b/i;
const _RESET_TIMER_PATTERN = /\breset\s+(?:the\s+)?timer\b/i;
const _ADD_TIME_PATTERN = /\b(?:add|plus)\s+(.+?)\s+(?:to\s+)?(?:the\s+)?timer\b/i;
const _SUBTRACT_TIME_PATTERN = /\b(?:take off|subtract|minus|remove)\s+(.+?)\s+(?:from\s+)?(?:the\s+)?timer\b/i;
const _TIME_CHUNK_PATTERN = /(\d+)\s*(hours?|hrs?|hr|minutes?|mins?|min|seconds?|secs?|sec)\b/gi;
const _NUMBER_WORDS = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  half: 0.5,
};

function el(id) { return document.getElementById(id); }
function activeContainer() { return document.getElementById("chat-active"); }

function clearDismissTimeout() {
  if (_dismissTimeoutId) {
    clearTimeout(_dismissTimeoutId);
    _dismissTimeoutId = null;
  }
}

function format(seconds) {
  const whole = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function durationLabel(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const parts = [];
  if (h) parts.push(`${h} hour${h === 1 ? "" : "s"}`);
  if (m) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
  if (s && !h) parts.push(`${s} second${s === 1 ? "" : "s"}`);
  return parts.join(" ");
}

function updateDisplay() {
  el("timer-display").textContent = format(_remaining);
}

function setStepLabel(text) {
  el("timer-step").textContent = text || "Waiting for a timed step";
}

function applyTimerMode() {
  activeContainer()?.classList.toggle("timer-live", _isRunning);
}

function parseDurationSeconds(text) {
  if (!text) return null;
  const normalizedText = text.toLowerCase().replace(/-/g, " ");
  let total = 0;
  let matched = false;
  for (const match of normalizedText.matchAll(_TIME_CHUNK_PATTERN)) {
    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (unit.startsWith("hour") || unit.startsWith("hr")) total += value * 3600;
    else if (unit.startsWith("min")) total += value * 60;
    else if (unit.startsWith("sec")) total += value;
    matched = true;
  }

  const wordPattern = /\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|half)\s+(hours?|hrs?|hr|minutes?|mins?|min|seconds?|secs?|sec)\b/gi;
  for (const match of normalizedText.matchAll(wordPattern)) {
    const value = _NUMBER_WORDS[match[1].toLowerCase()];
    const unit = match[2].toLowerCase();
    if (value == null) continue;
    if (unit.startsWith("hour") || unit.startsWith("hr")) total += value * 3600;
    else if (unit.startsWith("min")) total += value * 60;
    else if (unit.startsWith("sec")) total += value;
    matched = true;
  }

  return matched ? total : null;
}

function showTimer(stepText = "") {
  el("timer-widget").classList.remove("hidden");
  setStepLabel(stepText || "Timer is running");
  updateDisplay();
}

function hideTimer() {
  el("timer-widget").classList.add("hidden");
  setStepLabel("Waiting for a timed step");
}

function tick() {
  const now = performance.now();
  if (_lastTick !== null && !_paused) {
    _remaining -= (now - _lastTick) / 1000;
  }
  _lastTick = now;
  updateDisplay();

  if (_remaining <= 0) {
    _remaining = 0;
    stopTimerInternal();
    setStepLabel(`Timer finished: ${_activeStepText || "current timer"}`);
    updateDisplay();
    document.dispatchEvent(new CustomEvent("timerDone", { detail: { stepText: _activeStepText } }));
    clearDismissTimeout();
    _dismissTimeoutId = window.setTimeout(() => {
      dismissTimer();
    }, 2400);
  }
}

function stopTimerInternal() {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  _isRunning = false;
  _paused = false;
  _lastTick = null;
  applyTimerMode();
}

export function hasActiveTimer() {
  return _totalSeconds > 0;
}

export function startTimer(seconds, stepText = "") {
  clearDismissTimeout();
  stopTimerInternal();
  _totalSeconds = seconds;
  _remaining = seconds;
  _activeStepText = stepText;
  _isRunning = true;
  _paused = false;
  _lastTick = performance.now();
  showTimer(stepText || "Timer is running");
  applyTimerMode();
  _intervalId = setInterval(tick, 250);
}

export function dismissTimer() {
  clearDismissTimeout();
  stopTimerInternal();
  _totalSeconds = 0;
  _remaining = 0;
  _activeStepText = "";
  hideTimer();
}

export function pauseTimer() {
  if (!hasActiveTimer() || !_isRunning) return false;
  _paused = true;
  _isRunning = false;
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  applyTimerMode();
  return true;
}

export function resumeTimer() {
  if (!hasActiveTimer() || !_paused) return false;
  _paused = false;
  _isRunning = true;
  _lastTick = performance.now();
  applyTimerMode();
  _intervalId = setInterval(tick, 250);
  return true;
}

export function addTime(secondsDelta) {
  if (!hasActiveTimer()) return false;
  _remaining += secondsDelta;
  _totalSeconds = Math.max(_remaining, _totalSeconds + secondsDelta);
  updateDisplay();
  return true;
}

export function subtractTime(secondsDelta) {
  if (!hasActiveTimer()) return false;
  _remaining = Math.max(1, _remaining - secondsDelta);
  _totalSeconds = Math.max(_remaining, _totalSeconds - secondsDelta);
  updateDisplay();
  return true;
}

export function resetTimer() {
  if (!hasActiveTimer()) return false;
  clearDismissTimeout();
  _remaining = _totalSeconds;
  _paused = false;
  _isRunning = true;
  _lastTick = performance.now();
  updateDisplay();
  applyTimerMode();
  if (_intervalId) clearInterval(_intervalId);
  _intervalId = setInterval(tick, 250);
  return true;
}

export function parseTimerCommand(text) {
  const value = text.trim();
  if (!value) return null;
  const normalized = value.toLowerCase().replace(/[!?.,]/g, " ");
  const mentionedTimer = /\btimer\b/i.test(value);

  let match = value.match(_CREATE_TIMER_PATTERN) || value.match(_BARE_TIMER_PATTERN);
  if (match) {
    const seconds = parseDurationSeconds(match[1]);
    if (!seconds) return null;
    return { type: "start", seconds };
  }

  if (mentionedTimer) {
    const seconds = parseDurationSeconds(value);
    if (seconds) return { type: "start", seconds };
  }

  if (_PAUSE_TIMER_PATTERN.test(value)) return { type: "pause" };
  if (_RESUME_TIMER_PATTERN.test(value)) return { type: "resume" };
  if (_STOP_TIMER_PATTERN.test(value) || _DONE_TIMER_PATTERN.test(value)) return { type: "dismiss" };
  if (_RESET_TIMER_PATTERN.test(value)) return { type: "reset" };

  match = value.match(_ADD_TIME_PATTERN);
  if (match) {
    const seconds = parseDurationSeconds(match[1]);
    if (!seconds) return null;
    return { type: "add", seconds };
  }

  match = value.match(_SUBTRACT_TIME_PATTERN);
  if (match) {
    const seconds = parseDurationSeconds(match[1]);
    if (!seconds) return null;
    return { type: "subtract", seconds };
  }

  const doneWords = ["done", "finished", "complete", "completed"];
  const dismissWords = ["stop", "cancel", "end", "clear", "remove", "dismiss"];
  if (doneWords.some((word) => normalized.includes(word)) || dismissWords.some((word) => normalized.includes(word))) {
    return { type: "dismiss" };
  }

  return null;
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && _intervalId && !_paused) {
    _lastTick = performance.now();
  }
});
