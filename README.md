# Nova — multilingual support for TeleNova

Nova is a customer support prototype with a Python FastAPI server and a LangGraph policy agent. A React browser client provides the microphone, audio playback and account interface. PostgreSQL stores accounts, sessions, conversation history and support tickets. Each account retains its most recent 200 messages; older messages are deleted from the database as new ones are saved. The agent rewrites follow-up questions, searches policy documents and either answers with policy references or suggests a human ticket.

## Run locally

1. Create a Python 3.11+ virtual environment and install dependencies:
   ```sh
   python3 -m venv .venv
   .venv/bin/python -m pip install --upgrade 'pip>=26.2'
   .venv/bin/pip install -r server/requirements.txt
   .venv/bin/python -m server.app.download_embedding_model
   npm --prefix client ci
   ```
2. Copy `server/.env.example` to `server/.env`; set `LOCAL_DB_PASSWORD`, `DATABASE_URL`, `ADMIN_PASSWORD` and the API keys you need. Use a strong alphanumeric local database password to avoid URL-encoding issues. For a fresh installation, start the optional database container with `docker compose --env-file server/.env up -d`. It listens only on localhost, port 55432, and stores data in a Docker volume. This database is separate from any database already on that port; use only one at a time. Alternatively, use an existing local PostgreSQL server with pgvector. The admin email is `solongnososhort057@gmail.com`. PostgreSQL must have the pgvector extension installed, and the database user needs permission to create the extension, schema, tables and indexes. For the existing project-local PostgreSQL cluster (if one has already been initialized), start it before running the app:
   ```sh
   scripts/local-postgres.sh start
   ```
   Use `scripts/local-postgres.sh status` to check it and `scripts/local-postgres.sh stop` when finished. Its data lives in the ignored `.local-postgres/` directory. Do not delete that directory if you want to keep local accounts, history and tickets. The helper operates on this initialized cluster; on a different machine, create a local PostgreSQL database and set that machine's `DATABASE_URL` instead.
3. Start the server from the project root:
   ```sh
   .venv/bin/uvicorn server.app.main:app --reload --port 4000
   ```
   In a second terminal run `npm --prefix client run dev`, then open `http://localhost:3000`. Alternatively, run `npm ci` at the project root once, then run `npm run dev`.
4. To run without live AI services, set `MOCK_LLM=true` and `MOCK_GNANI=true`. Typed chat works in mock mode; voice recognition requires a Gnani key. When Gnani is configured, spoken answers stream from its voice service; otherwise the app falls back to a matching browser voice when available. The Stop voice control cancels both generation and playback. Microphone input reconnects when needed and sends a short tail of silence when stopped to help finalize speech recognition. Configure an OpenAI-compatible provider with `OPENAI_API_KEY`, `GROQ_API_KEY` or `HF_TOKEN`; `LLM_BASE_URL` and `LLM_MODEL` can override defaults.

The application stores data in the private `nova_private` schema. To import a prior local JSON store, back up `server/runtime-data.json` and run `.venv/bin/python -m server.app.import_local` from the project root. The original file is retained.

## Agent and retrieval

Uploaded policy passages are embedded **locally** using `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` (384 dimensions). PostgreSQL with the pgvector extension stores those vectors and ranks passages by cosine similarity. Existing uploaded PDFs are indexed on startup; uploads and their indexes are updated together. When uploads exist, they form the active knowledge base. Otherwise, the bundled telecom examples are also indexed and searched with pgvector. The server fails to start if the model files or pgvector are unavailable rather than silently falling back.

The top eight uploaded passages are passed to the configured language model for an answer. **Embedding and similarity search are local**, but the selected passages and customer question are sent to the configured LLM provider (currently Groq if configured). The model must cite a retrieved passage and quote evidence; this check does not prove the answer is correct. If generation fails or evidence cannot be verified, the app shows an unverified excerpt and offers support. Evaluate factual accuracy and language coverage before real use.

## Deployment

For a hosted environment such as Supabase, set `DATABASE_URL` to that environment’s PostgreSQL connection string. Changing URLs does not transfer existing data; configure backups and migrate data separately. Production connections to remote databases require TLS (`sslmode=require`, `verify-ca`, or `verify-full`); prefer `verify-full` with a trusted CA certificate.

The `Dockerfile` builds the browser assets and runs the Python server as one service. Set `DATABASE_URL`, `ADMIN_PASSWORD` (at least 12 characters in production), `NODE_ENV=production`, and any provider keys in the host's secret settings. The host must support HTTPS and WebSockets. `/api/health` checks database connectivity. The server must be able to reach PostgreSQL with pgvector installed and enabled; configure the provider's TLS/certificate requirements. The Docker build downloads the local embedding model, so it needs network access during the build. The private database schema must not be exposed through Supabase Data APIs.

Before publishing, rotate any credential previously present in Git history and assess whether history must be rewritten. This remains a prototype: use an identity provider with verified email, password recovery and admin MFA; add distributed rate limiting, backups, retention controls, monitoring, and end-to-end security and load testing before deploying for real users.

## Tests and evaluation

Install `server/requirements-dev.txt` to run `npm test`. The database integration test runs only when `TEST_DATABASE_URL` points to a **disposable** PostgreSQL database; it creates tables and test records there. With the local database running and indexed, run `npm run eval` for a retrieval-only evaluation on the bundled English, Hindi and Tamil synthetic dataset. It measures pgvector top-1/top-8 document retrieval and threshold matches, not factual answer correctness, speech quality, or real-user accuracy.

## Updating policies

Sign in to the admin desk using the reserved admin account, then use **Knowledge base** to upload a text-based PDF, UTF-8 Markdown or text document (up to 5 MB and 100 PDF pages). Supply a stable document ID and a policy name. An upload with an existing ID replaces that uploaded document. While any documents are uploaded, the bundled examples are not searched. New passages are stored in PostgreSQL and are available to subsequent questions without restarting. Only the current uploaded version is retained; keep original files and any older versions separately. An admin can remove an uploaded policy after confirmation; removing the last upload returns search to the bundled sample policies. PDF citations show the extracted page number; plain text and Markdown use passage references. Scanned PDFs need OCR before upload.

The selector offers English and ten Indian languages. Speech recognition depends on a working Gnani configuration; spoken output uses Gnani when configured, with device voices as a fallback. A capable configured language model is needed for simplification, personalized follow-up and responses in the selected language. These features and policy accuracy require language-by-language evaluation; a source excerpt or matching citation alone cannot guarantee factual grounding.

For explicit model selection, set `LLM_PROVIDER` to `groq`, `huggingface`, or `openai` in `server/.env`. When using Groq, set `GROQ_MODEL` to a chat model available to your account. Restart the Python server after changing `.env`. Voice selection uses `GNANI_TTS_MODEL` and `GNANI_VOICE`.
