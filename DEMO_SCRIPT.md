# Nova — video demonstration script

**Target length:** 2–3 minutes. Record the actual application, using the fictional policy in `examples/demo-policy.md` and demo accounts. Rehearse the voice questions in advance and allow time for real responses; show only the features and languages that work during the recording.

## 0:00–0:20 — Introduction

**Show:** Nova sign-in page and application overview.

**Say:**

“Hi, I’m Sarthak, and this is Nova, a multilingual, voice-first policy assistant. Nova helps people understand policy documents in simple language, ask follow-up questions, and find the source behind an answer. It also offers human support when a question needs more help.”

## 0:20–0:55 — Admin side

**Show:** Sign in with the admin account. Open **Admin desk**, show the knowledge base, and upload or show the fictional Sundial leave policy. Briefly show the support queue and status controls.

**Say:**

“Nova has two sides: an admin workspace and a user workspace. On the admin side, an administrator can upload a policy document, update it using the same document ID, and remove it when it is no longer needed. Nova processes the policy so it can be searched for future questions. The admin can also review support tickets, update their status, and add a support note.”

## 0:55–1:55 — User side and multilingual questions

**Show:** Sign out and sign in with a separate demo user. Open **Assistant**. Select the relevant language before each question. Point to the answer and policy reference. Show the stop voice button while an answer is playing if available.

**Say:**

“On the user side, people can sign in, ask by voice or text, and return to their recent conversations and support tickets. Let’s ask a question about the policy we uploaded.”

**Ask in English:** “How many paid leave days do full-time employees get each year?”

**After the actual response:** “The fictional policy says 18 days, and Nova provides a reference so the user can check the source.”

**Select Hindi and ask:** “छुट्टी के लिए कितने दिन पहले अनुरोध करना चाहिए?”

*(How many days in advance should I request leave? The fictional policy says seven calendar days.)*

**After the response:** “Here I’ve switched to Hindi. Nova can accept questions in different languages, and it can read the response aloud. The user can stop playback at any time.”

**If time permits, select Tamil and ask:** “முழுநேர ஊழியர்களுக்கு ஆண்டுக்கு எத்தனை நாட்கள் ஊதியத்துடன் கூடிய விடுப்பு கிடைக்கும்?”

*(How many paid leave days do full-time employees receive each year? The fictional policy says 18 days.)*

**Show:** Ask a follow-up such as “How early should I request it?” in the currently selected language, or ask about a benefit absent from the document and show the actual uncertainty or support option. Open **My tickets** if demonstrating a created ticket.

## 1:55–2:35 — Technology and close

**Show:** The answer and citation, then the interface or a simple architecture diagram.

**Say:**

“Behind the scenes, the client is built with React, and the backend uses Python, FastAPI, and a LangGraph workflow. Gnani Prisma provides speech recognition, and Gnani Timbre provides spoken responses. Policy passages are embedded locally with a multilingual embedding model and stored in PostgreSQL using pgvector. Nova uses cosine similarity to find relevant passages, then a separately configured language model generates an answer using that context.

Nova brings voice, policy references, and human support together in one experience. It’s a prototype, and language and answer quality still need broader evaluation. Thank you.”

## Recording notes

- The exact timing depends on response latency. For a 2–3 minute video, use English and Hindi as the primary questions; include Tamil only if it fits and works during rehearsal.
- Show a genuine live response. If recognition or speech fails, acknowledge it and use text instead; do not present a fallback as Gnani output.
- Do not show passwords, API keys, personal conversations, or private documents. Upload only the fictional demo policy; relevant passages and questions are sent to the configured language-model provider.
- The form asks for a 2–3 minute demo. Gnani also lists a separate 60-second demo award; a shorter edit can be created separately if useful.
