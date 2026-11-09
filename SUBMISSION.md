# Submission notes — Nova

## Project

**Nova: multilingual, voice-first policy support**

People often need to understand policies written in unfamiliar or formal language. Nova lets a user ask a question by speech or text, retrieves relevant policy passages, and returns a simpler response with source references. If the policy or supporting evidence is insufficient, it offers a human-support ticket.

## What is implemented

- Gnani Prisma speech-to-text over WebSocket and Gnani Timbre text-to-speech; the configured TTS model and voice are controlled by environment variables.
- A Python/FastAPI service and LangGraph workflow for query rewriting, retrieval, grounded response generation, and support escalation.
- PostgreSQL with pgvector and a local `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` embedding model; uploaded PDFs are searchable by cosine similarity.
- Policy document uploads, PDF page references, persistent accounts and tickets, and a stop-voice control.
- The currently configured answer-generation LLM is separate from Gnani: Qwen through Groq. Do not describe it as a Gnani model.

## Suggested demo — use synthetic data only

1. Start the local database, Python server, and browser client as described in `README.md`.
2. Sign in to the admin desk and upload `examples/demo-policy.md` with document ID `DEMO-LEAVE-01` and title `Sundial Demo Services Leave Policy`.
3. Ask: “According to the Sundial demo leave policy, how many paid leave days do full-time employees receive?” Show the answer and the policy citation.
4. Ask a follow-up such as “How early should I request it?” Show how the conversation uses prior context.
5. Ask something the policy does not cover. Show the uncertainty message and the option to create a support ticket.
6. If tested and working on your setup, demonstrate voice input, a supported Indian language, and the stop-voice button. Show real behavior; do not stage provider output.

Uploaded policies are visible to signed-in users and relevant excerpts are sent to the configured language-model provider. Never upload real personal or sensitive data for a public demo.

The one-page solution pitch is in `SOLUTION_PITCH.md`; a timed recording guide is in `DEMO_SCRIPT.md`.

## Submission checklist

- Confirm eligibility and read the [official challenge terms](https://www.gnani.ai/great-indian-ai-internship-registration-form).
- Record an honest working demo using synthetic data. Name the Gnani APIs used and accurately describe any other models.
- Provide an accessible project link containing the one-page pitch and an accessible 2–3 minute demo video link.
- Optionally, for the bonus awards category shown on the form, post about the solution on LinkedIn or X, tag Gnani, and provide the post link. Verify the current rules and deadline on the challenge site.
- Include only results that you actually measured. The repository does not establish accuracy for all languages or noisy speech.
