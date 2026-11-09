# Project guidance

- Nova is a Python/FastAPI and LangGraph backend with a React/TypeScript browser client. The browser JavaScript and audio worklet are required.
- Keep credentials in `server/.env` or deployment secret settings; never print or commit secrets, customer transcripts, private policy files, local databases, or model caches.
- PostgreSQL with pgvector is the source of truth. Use parameterized SQL, managed pool connections, and transactions for related policy/vector writes. Do not reset or delete the user's database.
- Embedded policy passages are generated locally. Answer generation sends the question and retrieved passages to the configured LLM provider; do not send user document content externally for testing without explicit authorization.
- Preserve the per-user 200-message retention limit, server-side authorization, source citations, and the audio stop/reconnect flow.
- Use synthetic policies, questions, identifiers, and audio in tests or demos. Do not represent synthetic benchmarks as measured results.
- Run `npm --prefix client run build`, `npm --prefix client run test`, and `.venv/bin/python -m pytest server/tests -q`. Database tests require `TEST_DATABASE_URL` pointing to a disposable PostgreSQL database with pgvector.
- Treat production readiness, language accuracy, generated answers, and live provider behavior as unverified unless actually tested.
