# Nova — multilingual, voice-first policy support

## Overview

Nova helps people navigate policy documents through a conversational interface. Users can ask a question in text or speech, receive an accessible explanation, and review references to the policy passages used in the response. The assistant preserves context for follow-up questions and offers a human-support ticket when it cannot verify sufficient evidence.

## User experience

- **Voice and language access:** The interface offers English and ten Indian languages, with speech recognition, spoken responses, and a control to stop playback. Voice functionality depends on the configured speech provider.
- **Policy-grounded responses:** Relevant document passages inform the response, with policy names and PDF page references where available. When supporting evidence cannot be verified, Nova presents an unverified excerpt and offers support.
- **Conversational continuity:** Follow-up questions can use previous context, and signed-in users can return to their recent conversation history. Each account retains its latest 200 messages.
- **Human support:** Users can create support tickets, and an administrator can review and update their status.
- **Policy management:** Administrators can upload or replace text-based PDFs, Markdown, and text documents to update the searchable knowledge base.

## Technical approach

The React client communicates with a Python/FastAPI backend. A LangGraph workflow coordinates question rewriting, policy retrieval, response generation, and support escalation. Gnani Prisma provides speech-to-text over WebSocket, and Gnani Timbre provides text-to-speech when configured.

Nova generates policy embeddings locally using `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`. PostgreSQL with pgvector stores the embeddings and retrieves relevant passages using cosine similarity. A separately configured language model generates the answer from those passages. PostgreSQL also stores accounts, sessions, recent messages, tickets, and policy data.

The user's question and retrieved passages are sent to the configured language-model provider for answer generation. Source and evidence checks are designed to make responses more transparent; they do not guarantee correctness.

## Project status

Nova is a working prototype combining multilingual interaction, document retrieval, citations, persistent history, and support escalation. Further evaluation is needed to establish answer accuracy and speech quality across languages and real-world conditions. Production use would also require stronger identity controls, operational monitoring, security review, and load testing.
