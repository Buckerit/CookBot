import { api } from "./api.js";
import { getSelectedRecipe } from "./recipe.js";
import {
  addTime,
  dismissTimer,
  hasActiveTimer,
  pauseTimer,
  resetTimer,
  resumeTimer,
  startTimer,
  subtractTime,
} from "./timer.js";
import { emitChefState } from "./chef.js";
import { icons } from "./icons.js";

let _pc = null;
let _dc = null;
let _mediaStream = null;
let _audioEl = null;
let _active = false;
let _sessionReady = false;

function el(id) { return document.getElementById(id); }

export function isRealtimeActive() {
  return _active;
}

function setButtonState() {
  const button = el("btn-mic-toggle");
  const iconEl = button?.querySelector(".icon-button");
  if (!button || !iconEl) return;

  button.classList.toggle("active", _active);
  button.setAttribute("aria-pressed", _active ? "true" : "false");
  button.setAttribute("title", _active ? "Stop live voice" : "Start live voice");
  button.setAttribute("aria-label", _active ? "Stop live voice" : "Start live voice");
  iconEl.innerHTML = _active ? icons.micActive : icons.mic;
}

function currentInstruction() {
  return el("step-instruction")?.textContent?.trim() || "";
}

function currentTips() {
  const tips = Array.from(document.querySelectorAll("#step-tips span")).map((node) => node.textContent?.trim()).filter(Boolean);
  return tips;
}

function buildInstructions() {
  const recipe = getSelectedRecipe();
  const stepLabel = el("step-label")?.textContent?.trim() || "";
  const instruction = currentInstruction();
  const tips = currentTips();

  const recipeLines = recipe ? [
    `Recipe title: ${recipe.title}`,
    recipe.servings ? `Servings: ${recipe.servings}` : "",
    recipe.ingredients?.length ? `Ingredients: ${recipe.ingredients.map((ing) => [ing.quantity, ing.unit, ing.name].filter(Boolean).join(" ")).join(", ")}` : "",
    recipe.steps?.length ? `All steps: ${recipe.steps.map((step, index) => `${index + 1}. ${step.instruction}`).join(" | ")}` : "",
  ].filter(Boolean) : ["No recipe is selected yet."];

  const stepLines = instruction ? [
    `Current UI step: ${stepLabel}`,
    `Current instruction: ${instruction}`,
    tips.length ? `Current tips: ${tips.join(" | ")}` : "",
  ].filter(Boolean) : ["No cooking session is active yet."];

  return [
    "You are CookAssist, a warm, hands-free cooking guide.",
    "Speak naturally, briefly, and clearly.",
    "When the user wants to navigate recipe steps, use the navigate_recipe tool instead of just talking about it.",
    "When the user wants to start, pause, resume, cancel, reset, add to, or subtract from a timer, use the manage_timer tool.",
    "After a tool call succeeds, give a short spoken confirmation and continue helping.",
    "Base your cooking answers only on the recipe context below. If the answer is not in the recipe, say that briefly.",
    recipeLines.join("\n"),
    stepLines.join("\n"),
  ].join("\n\n");
}

function sendRealtimeEvent(event) {
  if (_dc?.readyState === "open") {
    _dc.send(JSON.stringify(event));
  }
}

function syncSession() {
  if (!_sessionReady) return;
  sendRealtimeEvent({
    type: "session.update",
    session: {
      output_modalities: ["audio"],
      audio: {
        input: {
          turn_detection: {
            type: "semantic_vad",
          },
        },
        output: {
          voice: "marin",
        },
      },
      instructions: buildInstructions(),
      tools: [
        {
          type: "function",
          name: "navigate_recipe",
          description: "Move through the current recipe step-by-step.",
          parameters: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["next", "previous", "repeat", "jump"],
              },
              step_number: {
                type: "integer",
                description: "1-based step number when action is jump.",
              },
            },
            required: ["action"],
          },
        },
        {
          type: "function",
          name: "manage_timer",
          description: "Start or modify the active timer for the cooking flow.",
          parameters: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["start", "pause", "resume", "reset", "cancel", "add", "subtract"],
              },
              duration_seconds: {
                type: "integer",
                description: "How many seconds to start, add, or subtract.",
              },
            },
            required: ["action"],
          },
        },
      ],
      tool_choice: "auto",
    },
  });
}

async function runTool(item) {
  let output = { ok: true };

  try {
    const args = item.arguments ? JSON.parse(item.arguments) : {};

    if (item.name === "navigate_recipe") {
      const action = args.action;
      if (action === "next") {
        document.dispatchEvent(new CustomEvent("voiceCommand", { detail: { text: "next" } }));
        output = { ok: true, action };
      } else if (action === "previous") {
        document.dispatchEvent(new CustomEvent("voiceCommand", { detail: { text: "previous" } }));
        output = { ok: true, action };
      } else if (action === "repeat") {
        document.dispatchEvent(new CustomEvent("voiceCommand", { detail: { text: "repeat" } }));
        output = { ok: true, action };
      } else if (action === "jump" && Number.isInteger(args.step_number)) {
        document.dispatchEvent(new CustomEvent("jumpToStep", { detail: Math.max(0, args.step_number - 1) }));
        output = { ok: true, action, step_number: args.step_number };
      } else {
        output = { ok: false, error: "Unsupported navigation command." };
      }
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      syncSession();
    } else if (item.name === "manage_timer") {
      const action = args.action;
      const seconds = Number(args.duration_seconds || 0);

      if (action === "start" && seconds > 0) {
        startTimer(seconds, currentInstruction() || "Cooking timer");
      } else if (action === "pause") {
        if (!pauseTimer()) throw new Error("There is no running timer to pause.");
      } else if (action === "resume") {
        if (!resumeTimer()) throw new Error("There is no paused timer to resume.");
      } else if (action === "reset") {
        if (!resetTimer()) throw new Error("There is no timer to reset.");
      } else if (action === "cancel") {
        if (!hasActiveTimer()) throw new Error("There is no timer to cancel.");
        dismissTimer();
      } else if (action === "add" && seconds > 0) {
        if (!addTime(seconds)) throw new Error("There is no timer to update.");
      } else if (action === "subtract" && seconds > 0) {
        if (!subtractTime(seconds)) throw new Error("There is no timer to update.");
      } else {
        throw new Error("Unsupported timer command.");
      }
      output = { ok: true, action, duration_seconds: seconds || undefined };
    } else {
      output = { ok: false, error: `Unknown tool: ${item.name}` };
    }
  } catch (error) {
    output = { ok: false, error: error.message || "Tool execution failed." };
  }

  sendRealtimeEvent({
    type: "conversation.item.create",
    item: {
      type: "function_call_output",
      call_id: item.call_id,
      output: JSON.stringify(output),
    },
  });
  sendRealtimeEvent({
    type: "response.create",
    response: {
      output_modalities: ["audio"],
    },
  });
}

function handleRealtimeEvent(rawEvent) {
  let event = rawEvent;
  if (typeof rawEvent === "string") {
    try {
      event = JSON.parse(rawEvent);
    } catch (error) {
      console.warn("Failed to parse realtime event:", error);
      return;
    }
  }

  if (event.type === "session.created" || event.type === "session.updated") {
    _sessionReady = true;
    syncSession();
    return;
  }

  if (event.type === "input_audio_buffer.speech_started") {
    emitChefState("thinking", "Listening.", 1200);
    return;
  }

  if (event.type === "response.created") {
    emitChefState("talking", "Talking through it.");
    return;
  }

  if (event.type === "response.done") {
    const items = event.response?.output || [];
    const functionCall = items.find((item) => item.type === "function_call" && item.status === "completed");
    if (functionCall) {
      void runTool(functionCall);
      return;
    }
    emitChefState("idle", "Ready when you are.", 1200);
    return;
  }

  if (event.type === "error") {
    console.error("Realtime error:", event);
    emitChefState("thinking", "Live voice hit an error.", 1800);
  }
}

function cleanupConnection() {
  _sessionReady = false;

  if (_dc) {
    try {
      _dc.close();
    } catch (error) {
      console.warn("Realtime data channel close error:", error);
    }
    _dc = null;
  }

  if (_pc) {
    try {
      _pc.close();
    } catch (error) {
      console.warn("Realtime peer close error:", error);
    }
    _pc = null;
  }

  if (_mediaStream) {
    _mediaStream.getTracks().forEach((track) => track.stop());
    _mediaStream = null;
  }

  if (_audioEl) {
    _audioEl.srcObject = null;
  }
}

async function startRealtime() {
  if (_active) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support microphone capture.");
  }
  if (window.RTCPeerConnection == null) {
    throw new Error("This browser does not support WebRTC.");
  }

  _audioEl = _audioEl || document.createElement("audio");
  _audioEl.autoplay = true;

  _pc = new RTCPeerConnection();
  _dc = _pc.createDataChannel("oai-events");
  _dc.addEventListener("message", (event) => handleRealtimeEvent(event.data));
  _dc.addEventListener("open", () => {
    _sessionReady = true;
    syncSession();
    emitChefState("thinking", "Live voice is ready.", 1400);
  });
  _dc.addEventListener("close", () => {
    _sessionReady = false;
  });

  _pc.ontrack = (event) => {
    _audioEl.srcObject = event.streams[0];
  };

  _mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  _mediaStream.getTracks().forEach((track) => _pc.addTrack(track, _mediaStream));

  const offer = await _pc.createOffer();
  await _pc.setLocalDescription(offer);

  const answerSdp = await api.createRealtimeSession(offer.sdp);
  await _pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

  _active = true;
  setButtonState();
}

function stopRealtime() {
  if (!_active && !_pc) return;
  cleanupConnection();
  _active = false;
  setButtonState();
  emitChefState("idle", "Ready when you are.", 1200);
}

async function toggleRealtime() {
  const button = el("btn-mic-toggle");
  button?.setAttribute("disabled", "true");

  try {
    if (_active) {
      stopRealtime();
    } else {
      await startRealtime();
    }
  } catch (error) {
    console.error("Realtime start failed:", error);
    stopRealtime();
    document.dispatchEvent(new CustomEvent("realtimeError", { detail: { message: error.message || "Live voice failed to start." } }));
  } finally {
    button?.removeAttribute("disabled");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setButtonState();
  el("btn-mic-toggle")?.addEventListener("click", () => {
    void toggleRealtime();
  });
  document.addEventListener("recipeSelected", () => {
    syncSession();
  });
  document.addEventListener("cookingStateUpdated", () => {
    syncSession();
  });
  document.addEventListener("realtimeError", (event) => {
    const message = event.detail?.message || "Live voice failed to start.";
    const chat = el("chat-messages");
    if (chat) {
      const bubble = document.createElement("div");
      bubble.className = "chat-bubble bubble-bot";
      bubble.textContent = message;
      chat.appendChild(bubble);
      chat.scrollTop = chat.scrollHeight;
    }
  });
});

export function stopRealtimeSession() {
  stopRealtime();
}
