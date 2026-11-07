# Multilingual Customer Support – TeleNova Telecom

**Multilingual Customer Support** is an enterprise-grade, grounded voice customer support platform built for the **Gnani Challenge** (Great Indian AI Internship Challenge). It empowers customers to speak naturally in **10 Indian languages** (and mixed Hinglish), cross-lingually retrieves facts from **TeleNova's official policy documents**, speaks back in the customer's language using live streaming neural voice, and routes unanswerable or complex issues to a dedicated **Human Support Admin Desk**.

---

## 🏛️ Architecture & Dual-Portal System

### 1. Customer Voice Portal (`/client`)
- **Classic Enterprise Theme**: Clean, accessible, high-contrast telecom service desk styling (warm neutral canvas, crisp white cards, classic deep navy accents).
- **Push-to-Talk & Streaming Voice**: `AudioWorklet` captures 16-bit PCM mono audio over full-duplex WebSocket (`/ws/voice`).
- **Grounded Dual Response**: Shows full written answer with verified policy citations (`[TN-POL-XX]`), while streaming a spoken summary through Gnani Timbre.
- **Dual Telephony Modes**: Switch between **16kHz Studio HD Voice** and **8kHz Narrowband Telephony Line** (G.711 bandpass filter, 300Hz–3400Hz).
- **Instant Barge-In**: User can interrupt audio synthesis at any millisecond.
- **Support Escalation**: One-click escalation to human representatives when inquiries fall outside policy scope.

### 2. Human Support Admin Desk (`/client/src/components/AdminSupportDesk.tsx`)
- **Escalation Queue**: View all customer support tickets (`TN-SR-XXXXXX`), language used, inquiry transcript, and escalation summary.
- **Status Lifecycle**: Toggle tickets between `OPEN`, `IN_PROGRESS`, and `RESOLVED`.
- **Human Agent Notes**: Representative notes and resolution logging saved directly to the database/state.
- **Live Turn Telemetry**: Real-time audit feed of all customer interactions with Time-To-First-Audio (TTFA) and cosine retrieval scores.

### 3. Backend & Gateway (`/server`)
- **Gnani Prisma STT**: Streaming WebSocket bridge with BCP-47 language codes (`en-IN`, `hi-IN`, `ta-IN`, etc.).
- **Gnani Timbre TTS**: Low-latency streaming neural synthesis (`timbre-v3.0`, `Shivani` voice) with sentence-by-sentence pipelining.
- **Knowledge Base (`/data/policies`)**: 12 verified telecom policies (prepaid tariffs, postpaid billing, MNP, eSIM, roaming, 5G FUP, refunds, APN, fiber, DND, recharge, KYC).
- **RAG Engine**: Multilingual vector embeddings and concept mapping with strict refusal thresholding.

---

## 🚀 Quickstart (Running Locally)

```bash
# 1. Start Server (Backend)
cd server
npm install
npm run dev

# 2. Start Client (Frontend)
cd client
npm install
npm run dev
```

Visit `http://localhost:3000` in Google Chrome:
- Click **"Voice Customer Desk"** to speak with the telecom assistant.
- Click **"Human Support Admin"** in the top navigation to view and manage escalated customer tickets!
