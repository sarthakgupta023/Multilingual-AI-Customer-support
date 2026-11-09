# Nova — voice-first policy support

**Problem.** Policy documents can be long, difficult to understand, and inaccessible to people who prefer speaking or using an Indian language. Support teams also need a way to handle questions that cannot be answered from those documents.

**Solution.** Nova is a multilingual support prototype that lets users ask questions by voice or text and receive a plain-language response grounded in uploaded policies. Answers can include policy references and PDF page numbers. When the system cannot verify supporting evidence, it presents an unverified excerpt and offers a support-ticket route. Users can stop spoken playback at any time.

**How it works.** Gnani Prisma handles speech recognition and Gnani Timbre provides speech output when configured. A Python/FastAPI service uses a LangGraph workflow to handle conversation context, retrieve relevant passages and generate a response. Passages are embedded locally with `paraphrase-multilingual-MiniLM-L12-v2`; PostgreSQL and pgvector perform cosine similarity search. An independently configured language model generates the answer—for example, Qwen through Groq. Administrators can upload and replace policy documents, while accounts, recent conversation history and tickets persist in PostgreSQL.

**Demonstration.** A user asks how many paid leave days are available under a fictional policy, checks the cited source, and asks a follow-up. An unsupported question demonstrates the uncertainty and support flow. The demo uses synthetic data.

**Current status and next steps.** Nova is a prototype. The interface offers English and ten Indian languages, but answer quality and speech coverage have not been validated for every language. Source verification reduces unsupported responses but does not guarantee correctness. Next steps include broader multilingual and speech evaluation, improved retrieval for difficult queries, stronger account security, monitoring and deployment testing.
