// app.js — main app orchestrator

import { loadRecipeList, getSelectedRecipe } from "./recipe.js";
import { startCookingSession } from "./chat.js";
import { api } from "./api.js";
import { icons } from "./icons.js";

function el(id) { return document.getElementById(id); }
let _activeCookingRecipeId = null;

async function init() {
  const logoIcon = document.querySelector(".icon-logo");
  const emptyIcon = document.querySelector(".icon-empty");
  const ttsIcon = document.querySelector("#btn-tts-toggle .icon-button");
  if (logoIcon) logoIcon.innerHTML = icons.logoHat;
  if (emptyIcon) emptyIcon.innerHTML = icons.logoHat;
  if (ttsIcon) ttsIcon.innerHTML = icons.speaker;

  await loadRecipeList();

  el("btn-start-cooking")?.addEventListener("click", async () => {
    const recipe = getSelectedRecipe();
    if (!recipe) return;

    try {
      const session = await api.startSession(recipe.id);
      await startCookingSession(recipe, session.session_id);
      _activeCookingRecipeId = recipe.id;
      el("btn-start-cooking").textContent = "Restart Cooking";
    } catch (e) {
      console.error("Failed to start session:", e);
      alert(`Could not start session: ${e.message}`);
    }
  });

  el("btn-new-recipe")?.addEventListener("click", () => {
    el("ingest-panel")?.scrollIntoView({ behavior: "smooth" });
    el("ingest-text")?.focus();
  });

  document.addEventListener("recipeSelected", async (e) => {
    const recipe = e.detail;
    const startButton = el("btn-start-cooking");
    if (startButton) {
      startButton.textContent = recipe?.id === _activeCookingRecipeId ? "Restart Cooking" : "Start Cooking";
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
