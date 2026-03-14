// api.js — centralized API calls

const BASE = "";  // Same origin

export async function fetchJson(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Recipes
  listRecipes: () => fetchJson("/recipes"),
  getRecipe: (id) => fetchJson(`/recipes/${id}`),
  deleteRecipe: (id) => fetchJson(`/recipes/${id}`, { method: "DELETE" }),

  // Ingest
  ingestText: (text, sourceUrl = "") =>
    fetchJson("/ingest/text", {
      method: "POST",
      body: JSON.stringify({ text, source_url: sourceUrl }),
    }),

  ingestUrl: (url) =>
    fetchJson("/ingest/url", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),

  ingestFile: (file) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetchJson("/ingest/file", { method: "POST", headers: {}, body: fd });
  },

  getIngestStatus: (taskId) => fetchJson(`/ingest/status/${taskId}`),

  // Chat sessions
  startSession: (recipeId) =>
    fetchJson("/sessions", {
      method: "POST",
      body: JSON.stringify({ recipe_id: recipeId }),
    }),
  getSession: (sessionId) => fetchJson(`/sessions/${sessionId}`),

  createRealtimeSession: async (offerSdp) => {
    const res = await fetch(`${BASE}/realtime/session`, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: offerSdp,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail));
    }
    return res.text();
  },

  // TTS — returns raw response for streaming
  tts: (text) =>
    fetch(`${BASE}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }),
};

window.cookApi = api;
