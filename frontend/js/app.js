// app.js — main app orchestrator

import { loadRecipeList, getSelectedRecipe, getSavedSelectedRecipeId, selectRecipe } from "./recipe.js";
import { clearCookingSessionPersistence, endCookingSession, getPersistedActiveSession, resetCookingUi, startCookingSession } from "./chat.js";
import { api } from "./api.js";
import { icons } from "./icons.js";
import { stopSpeaking } from "./tts.js";
import { clearEventQueue } from "./chat.js";
import { enableAutoListen } from "./realtime.js";

function el(id) { return document.getElementById(id); }
let _activeCookingRecipeId = null;

function updateCookingButtons() {
  const startButton = el("btn-start-cooking");
  const endButton = el("btn-end-cooking");
  const recipe = getSelectedRecipe();
  const hasActiveSession = Boolean(_activeCookingRecipeId);
  const isActiveRecipe = Boolean(recipe?.id && recipe.id === _activeCookingRecipeId);

  if (startButton) {
    startButton.textContent = isActiveRecipe ? "Restart Cooking" : "Start Cooking";
  }

  if (endButton) {
    endButton.disabled = !isActiveRecipe;
    endButton.classList.toggle("active", isActiveRecipe);
  }
}

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
    updateCookingButtons();
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
  const stopSpeechIcon = document.querySelector("#btn-stop-speech .icon-button");
  if (logoIcon) logoIcon.innerHTML = icons.logoHat;
  if (emptyIcon) emptyIcon.innerHTML = icons.logoHat;
  if (micIcon) micIcon.innerHTML = icons.mic;
  if (ttsIcon) ttsIcon.innerHTML = icons.speaker;
  if (stopSpeechIcon) stopSpeechIcon.innerHTML = icons.stopX;

  el("btn-stop-speech")?.addEventListener("click", () => {
    stopSpeaking();
    clearEventQueue();
  });

  await loadRecipeList();
  await restoreUiState();

  el("btn-start-cooking")?.addEventListener("click", async () => {
    stopSpeaking();
    const recipe = getSelectedRecipe();
    if (!recipe) return;

    try {
      const session = await api.startSession(recipe.id);
      await startCookingSession(recipe, session.session_id);
      _activeCookingRecipeId = recipe.id;
      updateCookingButtons();
      enableAutoListen();
    } catch (e) {
      console.error("Failed to start session:", e);
      alert(`Could not start session: ${e.message}`);
    }
  });

  el("btn-end-cooking")?.addEventListener("click", () => {
    if (!_activeCookingRecipeId || getSelectedRecipe()?.id !== _activeCookingRecipeId) return;
    endCookingSession();
  });

  document.addEventListener("recipeSelected", async (e) => {
    stopSpeaking();
    void e.detail;
    updateCookingButtons();
  });

  document.addEventListener("cookingSessionStateChanged", (e) => {
    _activeCookingRecipeId = e.detail?.active ? e.detail?.recipeId ?? null : null;
    updateCookingButtons();
  });
}

document.addEventListener("DOMContentLoaded", init);
