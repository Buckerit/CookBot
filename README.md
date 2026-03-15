# CookPilot 🍳🤖

**Your hands-free AI cooking assistant**

CookPilot is an AI-powered cooking companion that lets you follow recipes **without touching your phone or pausing videos**. Instead of constantly stopping and rewinding cooking videos, you can simply **talk to CookPilot** and it will guide you through the recipe step by step.

CookPilot analyzes a YouTube cooking video or a text recipe, and lets you interact with it through a conversational interface while you cook.

---

## 🚀 Inspiration

Cooking videos are full of information, but they can be frustrating in the kitchen. You often have to:

* Pause and rewind videos
* Skip around to find the next step
* Touch your phone with messy hands
* Rewatch sections to understand instructions

CookPilot solves this by turning cooking videos into an **interactive AI cooking assistant** that you can talk to while cooking.

---

## 🧠 How It Works

1. A user provides a **YouTube cooking video or a text recipe link**.
2. CookPilot processes the video by:

   * Extracting audio and keyframes for video and writings for text
   * Extracting the transcript
   * Analyzing the content with AI
   * Identifying the recipe steps and ingredients
3. The system converts the video into **structured cooking steps**.
4. While cooking, the user can **interact with the CookPilot with commands** like:
   * “next step”
   * “last step”
   * "repeat"
   * "restart"
   * “set timer”
5. CookPilot responds with clear step-by-step instructions.

---

## ✨ Features

* 🎥 **YouTube recipe parsing**
  Automatically analyzes cooking videos to extract instructions.

* 🧑‍🍳 **Step-by-step cooking guidance**
  Guides users through recipes interactively.

* 🗣 **Voice-friendly interaction**
  Ask questions and control the recipe without touching your device.

* 🔄 **Repeat or skip steps easily**
  Never lose your place in a recipe again.

* ⚡ **AI-powered understanding**
  Uses AI to interpret cooking instructions and summarize them clearly.
  
* ⏱️ **Timer**
  Set timer to remind users whenever they want.
---

## 🏗 Architecture & 🛠 Tech Stack

CookPilot is built with a modern AI stack:

**Frontend**

* Web interface for interacting with the assistant

**Tech Stack**

**Vanilla HTML/CSS/JS (no framework)**

* WebSocket — real-time chat
* WebRTC — OpenAI Realtime API voice connection
* Web Speech API — speech recognition fallback


**Backend**

* API built using **FastAPI**
* Handles video processing and AI interaction

**Tech Stack**

**FastAPI — REST API + WebSocket server**

* Python 3.11
* asyncpg — PostgreSQL async driver
* PostgreSQL — recipe and chat session storage
* OpenAI APIs — GPT-4o-mini (chat), GPT-4o (vision/entity extraction), Whisper (audio transcription fallback), TTS,
* Realtime API (voice)
* ElevenLabs — TTS (on the temp/main branch)
* yt-dlp — YouTube video + subtitle download
* ffmpeg — audio extraction, keyframe extraction
* PaddleOCR — on-screen text detection from video frames

**Infrastructure**

**Tech Stack**

**Docker + docker-compose — local development**

* GitHub — version control (Buckerit/CookPilot)

---

## 💡 Example Use Case

1. Paste a YouTube cooking video into CookPilot.
2. Start cooking.
3. Ask CookPilot:

> “What’s the first step?”

CookPilot responds:

> “First, chop the onions and heat olive oil in a pan over medium heat.”

Later you can ask:

> “What’s next?”

CookPilot keeps guiding you through the recipe.

---

## 🔮 Future Improvements

* Improve processing speed
* Fine-tune model with culinary expertise
* Grocery list generation
* Recipe recommendation based on available ingredients
* Multi-language support

---

## 👨‍💻 Authors

Built during a hackathon to explore **AI-powered cooking assistants** and hands-free human-AI interaction in everyday tasks.

---

## 🍜 Why CookPilot?

Cooking should be **fun, creative, and hands-on**—not interrupted by constantly pausing videos.

CookPilot lets you focus on what matters most:

**Cooking great food.**
