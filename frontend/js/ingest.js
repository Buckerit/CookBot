// ingest.js — recipe ingestion UI (text, url, file)

import { api } from "./api.js";
import { addRecipeToList } from "./recipe.js";
import { emitChefState } from "./chef.js";

function el(id) { return document.getElementById(id); }

function showError(msg) {
  const err = el("ingest-error");
  err.textContent = msg;
  err.classList.remove("hidden");
  setTimeout(() => err.classList.add("hidden"), 5000);
}

function setLoading(on) {
  el("btn-ingest-text").disabled = on;
  el("btn-ingest-url").disabled = on;
  el("btn-ingest-recipe-url").disabled = on;
  emitChefState(on ? "thinking" : "idle", on ? "Thinking through that recipe..." : "Ready when you are.");
}

// === Tabs ===
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      tab.classList.add("active");
      el(`tab-${tab.dataset.tab}`)?.classList.add("active");
    });
  });

  // === Text ingest ===
  el("btn-ingest-text")?.addEventListener("click", async () => {
    const text = el("ingest-text").value.trim();
    if (!text) { showError("Please paste some recipe text."); return; }
    setLoading(true);
    try {
      const recipe = await api.ingestText(text);
      addRecipeToList(recipe);
      el("ingest-text").value = "";
      emitChefState("celebrate", "Recipe parsed and saved.", 1800);
    } catch (e) {
      showError(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  });

  // === URL ingest ===
  el("btn-ingest-url")?.addEventListener("click", async () => {
    const url = el("ingest-url").value.trim();
    if (!url) { showError("Please enter a video URL."); return; }
    setLoading(true);
    el("url-status").classList.remove("hidden");
    el("url-status").textContent = "Queued...";

    try {
      const { task_id } = await api.ingestUrl(url);
      pollStatus(task_id);
    } catch (e) {
      showError(`Error: ${e.message}`);
      setLoading(false);
    }
  });

  // === Recipe URL ingest ===
  el("btn-ingest-recipe-url")?.addEventListener("click", async () => {
    const url = el("ingest-recipe-url").value.trim();
    if (!url) { showError("Please enter a recipe URL."); return; }
    setLoading(true);
    try {
      const recipe = await api.ingestRecipeUrl(url);
      addRecipeToList(recipe);
      el("ingest-recipe-url").value = "";
      emitChefState("celebrate", "Recipe imported successfully.", 1800);
    } catch (e) {
      showError(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  });
});

async function pollStatus(taskId) {
  const statusEl = el("url-status");
  let attempts = 0;
  const maxAttempts = 300; // 5 min at 1s intervals

  async function check() {
    attempts++;
    if (attempts > maxAttempts) {
      statusEl.textContent = "Timed out. Check back later.";
      setLoading(false);
      return;
    }

    try {
      const status = await api.getIngestStatus(taskId);
      statusEl.textContent = status.progress_message || status.status;

      if (status.status === "done" && status.recipe_id) {
        const recipe = await api.getRecipe(status.recipe_id);
        addRecipeToList(recipe);
        el("ingest-url").value = "";
        statusEl.classList.add("hidden");
        setLoading(false);
        emitChefState("celebrate", "Video recipe is ready.", 1800);
      } else if (status.status === "error") {
        showError(`Pipeline error: ${status.error}`);
        statusEl.classList.add("hidden");
        setLoading(false);
      } else {
        setTimeout(check, 1000);
      }
    } catch (e) {
      showError(`Status check failed: ${e.message}`);
      setLoading(false);
    }
  }

  check();
}
