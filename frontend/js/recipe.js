// recipe.js — recipe list and detail panel

import { api } from "./api.js";
import { icon } from "./icons.js";

let _recipes = [];
let _selectedRecipe = null;
let _pendingDeleteId = null;
const _SELECTED_RECIPE_KEY = "cookassist:selectedRecipeId";

export function getSelectedRecipe() { return _selectedRecipe; }
export function getSavedSelectedRecipeId() { return localStorage.getItem(_SELECTED_RECIPE_KEY); }

function el(id) {
  return document.getElementById(id);
}

function clearSelection() {
  _selectedRecipe = null;
  localStorage.removeItem(_SELECTED_RECIPE_KEY);
  el("recipe-detail-empty").classList.remove("hidden");
  el("recipe-detail-content").classList.add("hidden");
  renderList();
}

export async function loadRecipeList() {
  const list = document.getElementById("recipe-list");
  try {
    _recipes = await api.listRecipes();
    renderList();
  } catch (e) {
    list.innerHTML = `<p class="error-msg">Failed to load recipes: ${e.message}</p>`;
  }
}

export function addRecipeToList(recipe) {
  _recipes.unshift(recipe);
  renderList();
  selectRecipe(recipe.id);
}

function renderList() {
  const list = el("recipe-list");
  if (!_recipes.length) {
    list.innerHTML = `<div class="empty-recipes">${icon("logoHat", "icon icon-empty-recipes")}<p class="empty-hint">No recipes yet. Add one below!</p></div>`;
    return;
  }
  list.innerHTML = _recipes.map(r => `
    <div class="recipe-item${_selectedRecipe?.id === r.id ? " active" : ""}" data-id="${r.id}">
      <div class="recipe-item-copy">
        <div class="recipe-item-title">${esc(r.title)}</div>
      </div>
      <button class="recipe-delete" data-delete-id="${r.id}" title="Delete recipe" aria-label="Delete recipe">${icon("trash")}</button>
    </div>
  `).join("");

  list.querySelectorAll(".recipe-item").forEach((item) => {
    item.addEventListener("click", () => selectRecipe(item.dataset.id));
  });

  list.querySelectorAll(".recipe-delete").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openDeleteModal(button.dataset.deleteId);
    });
  });
}

export async function selectRecipe(id) {
  try {
    _selectedRecipe = await api.getRecipe(id);
    localStorage.setItem(_SELECTED_RECIPE_KEY, _selectedRecipe.id);
    renderDetail(_selectedRecipe);
    renderList();  // re-render to update active state
    document.dispatchEvent(new CustomEvent("recipeSelected", { detail: _selectedRecipe }));
    return _selectedRecipe;
  } catch (e) {
    console.error("Failed to select recipe:", e);
    return null;
  }
}

async function deleteRecipe(recipeId) {
  const recipe = _recipes.find((entry) => entry.id === recipeId) || _selectedRecipe;
  if (!recipeId || !recipe) return;

  try {
    await api.deleteRecipe(recipeId);
    _recipes = _recipes.filter((entry) => entry.id !== recipeId);
    if (_selectedRecipe?.id === recipeId) {
      clearSelection();
    } else {
      renderList();
    }
  } catch (e) {
    console.error("Failed to delete recipe:", e);
    closeDeleteModal();
    window.alert(`Could not delete recipe: ${e.message}`);
  }
}

function openDeleteModal(recipeId) {
  const recipe = _recipes.find((entry) => entry.id === recipeId) || _selectedRecipe;
  if (!recipe) return;
  _pendingDeleteId = recipeId;
  el("confirm-message").textContent = `Delete "${recipe.title}" from My Recipes?`;
  el("confirm-modal").classList.remove("hidden");
  el("confirm-modal").setAttribute("aria-hidden", "false");
}

function closeDeleteModal() {
  _pendingDeleteId = null;
  el("confirm-modal").classList.add("hidden");
  el("confirm-modal").setAttribute("aria-hidden", "true");
}

async function confirmDeleteRecipe() {
  if (!_pendingDeleteId) return;
  const recipeId = _pendingDeleteId;
  closeDeleteModal();
  await deleteRecipe(recipeId);
}

function renderDetail(recipe) {
  el("recipe-detail-empty").classList.add("hidden");
  const content = el("recipe-detail-content");
  content.classList.remove("hidden");

  el("detail-title").textContent = recipe.title;

  const meta = el("detail-meta");
  const metaItems = [
    recipe.servings && `${icon("servings")} ${recipe.servings}`,
    recipe.prep_time_minutes && `${icon("timer")} Prep ${recipe.prep_time_minutes}m`,
    recipe.cook_time_minutes && `${icon("flame")} Cook ${recipe.cook_time_minutes}m`,
    recipe.cuisine && `${icon("globe")} ${recipe.cuisine}`,
  ].filter(Boolean);
  meta.innerHTML = metaItems.map(m => `<span>${m}</span>`).join("");

  const ingList = el("detail-ingredients");
  ingList.innerHTML = recipe.ingredients.map(ing => {
    const parts = [ing.quantity, ing.unit, ing.name, ing.notes].filter(Boolean);
    return `<li>${esc(parts.join(" "))}</li>`;
  }).join("");

  const stepList = el("detail-steps");
  stepList.innerHTML = recipe.steps.map((s, i) => `
    <li data-step="${i}">${esc(s.instruction)}</li>
  `).join("");

  // Click on step in detail panel to jump chat to that step
  stepList.querySelectorAll("li").forEach(li => {
    li.addEventListener("click", () => {
      document.dispatchEvent(new CustomEvent("jumpToStep", { detail: parseInt(li.dataset.step) }));
    });
  });
}

export function highlightStep(index) {
  document.querySelectorAll("#detail-steps li").forEach((li, i) => {
    li.classList.toggle("current-step", i === index);
  });
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

document.addEventListener("DOMContentLoaded", () => {
  el("btn-delete-recipe")?.addEventListener("click", () => {
    if (_selectedRecipe) openDeleteModal(_selectedRecipe.id);
  });
  el("btn-confirm-cancel")?.addEventListener("click", closeDeleteModal);
  el("btn-confirm-delete")?.addEventListener("click", confirmDeleteRecipe);
  el("confirm-modal")?.addEventListener("click", (event) => {
    if (event.target === el("confirm-modal")) closeDeleteModal();
  });
});
