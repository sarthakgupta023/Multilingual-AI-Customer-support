# Nova — multilingual support for TeleNova

Nova is a customer support prototype with a Python FastAPI server and a LangGraph policy agent. A React browser client provides the microphone, audio playback and account interface. PostgreSQL stores accounts, sessions, conversation history and support tickets. Each account retains its most recent 200 messages; older messages are deleted from the database as new ones are saved. The agent rewrites follow-up questions, searches policy documents and either answers with policy references or suggests a human ticket.

## Run locally

1. Create a Python 3.11+ virtual environment and install dependencies:
   ```sh
   python3 -m venv .venv
   .venv/bin/pip install -r server/requirements.txt
   npm --prefix client install
   ```
2. Configure `server/.env` with a local PostgreSQL `DATABASE_URL` and an `ADMIN_PASSWORD`. The reserved admin email is `solongnososhort057@gmail.com`. The database user needs permission to create a schema, tables and indexes. On the current development machine, a dedicated local cluster has already been configured on `127.0.0.1:55432`. Start it before running the app:
   ```sh
   scripts/local-postgres.sh start
   ```
   Use `scripts/local-postgres.sh status` to check it and `scripts/local-postgres.sh stop` when finished. Its data lives in the ignored `.local-postgres/` directory. Do not delete that directory if you want to keep local accounts, history and tickets. The helper operates on this initialized cluster; on a different machine, create a local PostgreSQL database and set that machine's `DATABASE_URL` instead.
3. Start the server from the project root:
   ```sh
   .venv/bin/uvicorn server.app.main:app --reload --port 4000
   ```
   In a second terminal run `npm --prefix client run dev`, then open `http://localhost:3000`. Alternatively, install the root npm dependencies and run `npm run dev`.
4. To run without live AI services, set `MOCK_LLM=true` and `MOCK_GNANI=true`. Typed chat works in mock mode; voice recognition requires a Gnani key. The browser uses its own speech synthesis voice and the Stop voice control cancels playback. Configure an OpenAI-compatible provider with `OPENAI_API_KEY`, `GROQ_API_KEY` or `HF_TOKEN`; `LLM_BASE_URL` and `LLM_MODEL` can override defaults.

The local JSON account, messages and tickets were imported into the local development database; the source JSON file was retained. The Python server uses the same `nova_private` PostgreSQL tables and compatible scrypt hashes as the previous Node server; existing accounts and history are preserved. To import the earlier local JSON store, back up `server/runtime-data.json` and run `.venv/bin/python -m server.app.import_local` from the project root. The original file is retained.

## Agent and retrieval

The LangGraph workflow rewrites follow-up queries, scores locally chunked Markdown policies, routes low-scoring requests to human support, and generates a grounded response when an LLM is configured. Returned citations are limited to retrieved passages. The local retrieval score is a keyword/concept heuristic, not a vector similarity or a guarantee of accuracy. Without a configured LLM, or when generation fails, the response is explicitly marked unverified, shows a related excerpt and offers support; it may remain in English. When an LLM is available, the prompt asks for plain-language explanations and relevant eligibility follow-ups. A quoted passage is checked against the cited source, but this does not prove the answer is correct. Test answer quality, language coverage, escalation and voice recognition before real customer use.

## Deployment

For another environment, change `DATABASE_URL` to that environment’s PostgreSQL connection string. The previously configured Supabase URL is preserved separately in the ignored `server/.env` as `SUPABASE_DATABASE_URL`; it is not used until you deliberately make it the `DATABASE_URL`. Changing URLs does not transfer existing data. Configure backups and migrate data separately when needed.

The `Dockerfile` builds the browser assets and runs the Python server as one service. Set `DATABASE_URL`, `ADMIN_PASSWORD` (at least 12 characters in production), `NODE_ENV=production`, and any provider keys in the host's secret settings. The host must support HTTPS and WebSockets. `/api/health` checks database connectivity. The server must be able to reach PostgreSQL; configure the provider's TLS/certificate requirements. The private database schema must not be exposed through Supabase Data APIs.

This remains a prototype: use an identity provider with verified email, password recovery and admin MFA; add distributed rate limiting, backups, retention controls, monitoring, and end-to-end security and load testing before deploying for real users. Rotate the previously hard-coded Gnani credential if it was exposed.

## Tests and evaluation

Install `server/requirements-dev.txt` to run `npm test`. The database integration test runs only when `TEST_DATABASE_URL` points to a **disposable** PostgreSQL database; it creates tables and test records there. Run `MOCK_LLM=true npm run eval` for the existing English, Hindi and Tamil retrieval/refusal dataset. This measures first-document hits, not whether the answer is factually correct.

The previous TypeScript server and evaluation script remain in `server/src` and `evals/run_eval.ts` as historical reference; the documented commands and Docker image run the Python implementation. The frontend still uses React/TypeScript because microphone and browser playback require browser-side code.

## Updating policies

Sign in to the admin desk using the reserved admin account, then use **Knowledge base** to upload a text-based PDF, UTF-8 Markdown or text document (up to 5 MB and 100 PDF pages). Supply a stable document ID and a policy name. An upload with an existing ID replaces the active version, including a bundled policy with the same ID. New passages are stored in PostgreSQL and are available to subsequent questions without restarting. Only the current uploaded version is retained; keep original files and any older versions separately. PDF citations show the extracted page number; plain text and Markdown use passage references. Scanned PDFs need OCR before upload.

The selector offers English and ten Indian languages. Speech recognition depends on a working Gnani configuration; spoken output depends on voices installed on the user's device. A capable configured language model is needed for simplification, personalized follow-up and responses in the selected language. These features and policy accuracy require language-by-language evaluation; a source excerpt or matching citation alone cannot guarantee factual grounding.
