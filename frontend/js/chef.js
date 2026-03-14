let _resetTimer = null;

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
      setChefState("idle");
    }, duration);
  }
}

function onChefState(event) {
  const { state = "idle", caption = "", duration = 0 } = event.detail || {};
  setChefState(state, caption, duration);
}

document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("chefState", onChefState);
});

export function emitChefState(state, caption = "", duration = 0) {
  document.dispatchEvent(new CustomEvent("chefState", { detail: { state, caption, duration } }));
}
