# VoiceDesk – Multilingual AI Voice Customer Support (TeleNova)

VoiceDesk is a real-time, grounded voice customer support agent built for the **Gnani Challenge** (Great Indian AI Internship Challenge). It allows customers to speak naturally in **10 Indian languages** (plus Hinglish), cross-lingually retrieves answers from **TeleNova Telecom's official policy documents**, speaks back in the customer's language with streaming low latency, and raises support tickets for unanswerable inquiries.

---

## 🏗️ Architecture & Core Components

1. **Client (`/client`)**: Mobile-first React + Vite + Tailwind CSS app.
   - **AudioWorklet**: Real-time microphone capture converting audio to 16kHz 16-bit mono PCM.
   - **Full-Duplex WebSocket**: Streams audio to backend, receives live transcripts, Markdown answers, verified citations, and audio chunks.
   - **Streaming Web Audio Player**: Decodes base64 Linear16/WAV chunks into a seamless audio buffer queue with immediate **Barge-in** interruption.
   - **Language Selector**: Supports all 10 Gnani languages (Hindi, Tamil, Telugu, Kannada, Malayalam, Bengali, Marathi, Gujarati, Punjabi, English).
   - **Support Ticket Escalation**: Interactive modal when questions fall outside TeleNova's knowledge base.

2. **Server (`/server`)**: Node.js + Express + WebSocket relay.
   - **Gnani Prisma STT Gateway**: Upstream WebSocket bridge to `wss://api.vachana.ai/stt/v3/stream`.
   - **Gnani Timbre TTS Gateway**: Upstream streaming TTS to `wss://api.vachana.ai/api/v1/tts`.
   - **Local Phrase Cache**: Caches repeated greetings, thinking states, and ticket prompts to conserve the 5,000 credit budget and drop TTFA to <50ms.
   - **Cross-Lingual RAG Engine**: Semantic multilingual retrieval with dynamic thresholding to prevent hallucinations.
   - **Turn Logger & Telemetry**: Records Time To First Audio (TTFA), total latency, and source citations for evaluation.

3. **Knowledge Base (`/data/policies`)**: 12 detailed synthetic policy documents:
   - Prepaid tariffs, Postpaid billing, MNP porting, eSIM & lost SIM replacement, International roaming (GlobalPass), 5G Ultra & FUP, Complaints & refunds, Network APN settings, Fiber broadband, DND & spam protection, Recharge methods & cashback, and KYC reverification rules.

4. **Evaluation Harness (`/evals`)**:
   - 30 domain-specific questions in English, Hindi, and Tamil + 5 out-of-domain control questions.
   - Automated runner for Hit Rate, Refusal Accuracy, and Latency profiling.

---

## 🚀 Quickstart (Running Locally)

### 1. Install & Run in Mock Mode (No API keys required)
VoiceDesk comes with a built-in mock mode so you can test and develop immediately:

```bash
# Terminal 1: Run Backend
cd server
npm install
npm run dev

# Terminal 2: Run Frontend
cd client
npm install
npm run dev
```

Visit `http://localhost:3000` to interact with VoiceDesk.

---

## 🔑 Actual Data & API Keys Needed (To Go Live)

To connect live models, update `server/.env`:

| Key Name | Where to get it | Purpose |
| :--- | :--- | :--- |
| `GNANI_API_KEY` | [app.gnani.ai/voice](https://app.gnani.ai/voice) | Streaming STT (Prisma) and TTS (Timbre) |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) | Cross-lingual embeddings (`text-embedding-3-small`) and strict answer formulation (`gpt-4o-mini`) |
| `SUPABASE_URL` | [supabase.com](https://supabase.com) | Vector database for TeleNova policies |
| `SUPABASE_SERVICE_KEY` | Supabase Project Settings -> API | Service role key for vector matching RPC |

### Switching from Mock to Live
Once keys are added to `server/.env`, change:
```env
MOCK_GNANI=false
MOCK_LLM=false
USE_LOCAL_VECTOR_STORE=false
```

And run the vector database seed:
```bash
npm run seed
```

---

## 📊 Running Evaluations

Run the automated 35-test benchmark suite across English, Hindi, and Tamil:
```bash
npm run eval
```
The report will be output to console and saved as `evals/benchmark_report.json`.
