// app.js — main app orchestrator

import { loadRecipeList, getSelectedRecipe, getSavedSelectedRecipeId, selectRecipe } from "./recipe.js";
import { clearCookingSessionPersistence, getPersistedActiveSession, resetCookingUi, startCookingSession } from "./chat.js";
import { api } from "./api.js";
import { icons } from "./icons.js";

function el(id) { return document.getElementById(id); }
let _activeCookingRecipeId = null;

async function restoreUiState() {
  const persistedSession = getPersistedActiveSession();
  const selectedRecipeId = persistedSession?.recipeId || getSavedSelectedRecipeId();
  if (!selectedRecipeId) {
    resetCookingUi();
    return;
  }

  const recipe = await selectRecipe(selectedRecipeId);
  if (!recipe) {
    clearCookingSessionPersistence();
    resetCookingUi();
    return;
  }

  if (!persistedSession?.sessionId) return;

  try {
    const session = await api.getSession(persistedSession.sessionId);
    if (session.recipe_id !== recipe.id) {
      clearCookingSessionPersistence();
      resetCookingUi();
      return;
    }

    await startCookingSession(recipe, session.session_id);
    _activeCookingRecipeId = recipe.id;
    el("btn-start-cooking").textContent = "Restart Cooking";
  } catch (error) {
    console.warn("Failed to restore session:", error);
    clearCookingSessionPersistence();
    resetCookingUi();
  }
}

async function init() {
  const logoIcon = document.querySelector(".icon-logo");
  const emptyIcon = document.querySelector(".icon-empty");
  const micIcon = document.querySelector("#btn-mic-toggle .icon-button");
  const ttsIcon = document.querySelector("#btn-tts-toggle .icon-button");
  if (logoIcon) logoIcon.innerHTML = icons.logoHat;
  if (emptyIcon) emptyIcon.innerHTML = icons.logoHat;
  if (micIcon) micIcon.innerHTML = icons.mic;
  if (ttsIcon) ttsIcon.innerHTML = icons.speaker;

  await loadRecipeList();
  await restoreUiState();

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

  document.addEventListener("recipeSelected", async (e) => {
    const recipe = e.detail;
    const startButton = el("btn-start-cooking");
    if (startButton) {
      startButton.textContent = recipe?.id === _activeCookingRecipeId ? "Restart Cooking" : "Start Cooking";
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
