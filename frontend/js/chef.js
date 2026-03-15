let _resetTimer = null;
let _lockedState = null;

function el(id) {
  return document.getElementById(id);
}

function setChefState(state, caption = "", duration = 0) {
  const root = el("chef-assistant");
  if (!root) return;

  root.dataset.state = state;

  if (_resetTimer) {
    clearTimeout(_resetTimer);
    _resetTimer = null;
  }

  if (duration > 0) {
    _resetTimer = window.setTimeout(() => {
      if (_lockedState) {
        setChefState(_lockedState.state);
        return;
      }
      setChefState("idle");
    }, duration);
  }
}

function onChefState(event) {
  const {
    state = "idle",
    caption = "",
    duration = 0,
    lock = false,
    clearLock = false,
    overrideLock = false,
  } = event.detail || {};

  if (clearLock) {
    _lockedState = null;
    setChefState(state, caption, duration);
    return;
  }

  if (_lockedState && !overrideLock) {
    return;
  }

  if (lock) {
    _lockedState = { state, caption };
  }

  setChefState(state, caption, duration);
}

document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("chefState", onChefState);
});

export function emitChefState(state, caption = "", duration = 0, options = {}) {
  document.dispatchEvent(new CustomEvent("chefState", {
    detail: {
      state,
      caption,
      duration,
      ...options,
    },
  }));
}
