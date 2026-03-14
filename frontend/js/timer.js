// timer.js — countdown timer with alarm

let _timers = {};        // id → { total, remaining, paused, label, intervalId, lastTick }
let _nextId = 1;
let _audioCtx = null;

// ── Audio alarm ──────────────────────────────────────────────────────────────
function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

function playAlarm(label = "") {
  const ctx = getAudioCtx();
  // Three loud beep bursts
  const beepAt = (t, freq = 880, dur = 0.18) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "square";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.8, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.start(t);
    osc.stop(t + dur + 0.01);
  };

  const now = ctx.currentTime;
  for (let i = 0; i < 3; i++) {
    beepAt(now + i * 0.35, 880);
    beepAt(now + i * 0.35 + 0.2, 1100);
  }

  showAlarmBanner(label);
}

function showAlarmBanner(label) {
  let banner = document.getElementById("alarm-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "alarm-banner";
    banner.className = "alarm-banner";
    document.getElementById("app").prepend(banner);
  }
  banner.innerHTML = `⏰ ${label ? `<strong>${label}</strong> — ` : ""}Timer done! <button onclick="this.parentElement.remove()">Dismiss</button>`;
  banner.classList.add("alarm-visible");
  setTimeout(() => banner.classList.remove("alarm-visible"), 8000);
}

// ── Core timer logic ─────────────────────────────────────────────────────────
export function startTimer(seconds, label = "") {
  const id = _nextId++;
  _timers[id] = {
    id,
    label,
    total: seconds,
    remaining: seconds,
    paused: false,
    lastTick: performance.now(),
    intervalId: null,
  };

  _timers[id].intervalId = setInterval(() => _tick(id), 250);
  renderTimers();
  return id;
}

function _tick(id) {
  const t = _timers[id];
  if (!t) return;
  const now = performance.now();
  if (!t.paused) {
    t.remaining -= (now - t.lastTick) / 1000;
  }
  t.lastTick = now;

  if (t.remaining <= 0) {
    t.remaining = 0;
    clearInterval(t.intervalId);
    renderTimers();
    playAlarm(t.label);
    // Remove from list after 4s
    setTimeout(() => { delete _timers[id]; renderTimers(); }, 4000);
    return;
  }
  renderTimers();
}

function _format(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}

export function pauseTimer(id) {
  const t = _timers[id];
  if (!t) return;
  t.paused = !t.paused;
  if (!t.paused) t.lastTick = performance.now();
  renderTimers();
}

export function resetTimer(id) {
  const t = _timers[id];
  if (!t) return;
  t.remaining = t.total;
  t.paused = false;
  t.lastTick = performance.now();
  renderTimers();
}

export function removeTimer(id) {
  if (_timers[id]) {
    clearInterval(_timers[id].intervalId);
    delete _timers[id];
  }
  renderTimers();
}

// Recalc drift on tab focus
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    Object.values(_timers).forEach(t => { if (!t.paused) t.lastTick = performance.now(); });
  }
});

// ── Manual timer form ────────────────────────────────────────────────────────
export function initManualTimer() {
  const form = document.getElementById("manual-timer-form");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const h = parseInt(document.getElementById("timer-h").value) || 0;
    const m = parseInt(document.getElementById("timer-m").value) || 0;
    const s = parseInt(document.getElementById("timer-s").value) || 0;
    const label = document.getElementById("timer-label").value.trim();
    const total = h * 3600 + m * 60 + s;
    if (total <= 0) return;

    startTimer(total, label || "Manual timer");

    // Reset form
    document.getElementById("timer-h").value = "";
    document.getElementById("timer-m").value = "";
    document.getElementById("timer-s").value = "";
    document.getElementById("timer-label").value = "";
  });
}

// ── Render all active timers ─────────────────────────────────────────────────
function renderTimers() {
  const container = document.getElementById("timers-container");
  if (!container) return;

  const ids = Object.keys(_timers);
  container.classList.toggle("hidden", ids.length === 0);

  container.innerHTML = ids.map(id => {
    const t = _timers[id];
    const pct = Math.max(0, (t.remaining / t.total) * 100);
    const done = t.remaining <= 0;
    return `
      <div class="timer-card${done ? " timer-done" : ""}">
        <div class="timer-card-top">
          <span class="timer-card-label">${t.label || "Timer"}</span>
          <button class="timer-remove" onclick="window._removeTimer(${id})">✕</button>
        </div>
        <div class="timer-card-display">${done ? "Done! ⏰" : _format(t.remaining)}</div>
        <div class="timer-track"><div class="timer-progress" style="width:${pct}%"></div></div>
        <div class="timer-card-btns">
          <button onclick="window._pauseTimer(${id})">${t.paused ? "Resume" : "Pause"}</button>
          <button onclick="window._resetTimer(${id})">Reset</button>
        </div>
      </div>`;
  }).join("");
}

// Expose to inline onclick handlers
window._pauseTimer = pauseTimer;
window._resetTimer = resetTimer;
window._removeTimer = removeTimer;
