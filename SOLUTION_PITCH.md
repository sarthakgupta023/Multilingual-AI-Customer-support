# Nova — policy support that speaks your language

**The challenge.** People often need quick answers from lengthy policy documents written in formal language. Finding the right clause can be difficult, especially for someone who prefers to speak or communicate in an Indian language. When a question falls outside the available policy, it should reach a human rather than receive an invented answer.

**The solution.** Nova is a voice-first, multilingual policy support assistant. Users can ask questions by speech or text, receive a plain-language response, and inspect the policy references behind it. The assistant retains conversational context for follow-up questions, supports spoken responses with a stop control, and offers a support-ticket route when evidence is insufficient.

**How it works.** Gnani Prisma provides speech recognition and Gnani Timbre provides speech output when configured. A Python/FastAPI backend uses LangGraph to coordinate conversation context, retrieval, response generation, and escalation. Policy passages are embedded locally using `paraphrase-multilingual-MiniLM-L12-v2`, stored in PostgreSQL with pgvector, and retrieved through cosine similarity search. A separately configured language model generates the response from the retrieved passages. Administrators can upload and replace policy documents; accounts, recent conversations, and tickets persist in PostgreSQL.

**Why it matters.** Nova brings voice, multilingual access, source references, and human support into a single experience. It makes policies easier to navigate while giving users a way to inspect supporting evidence and seek help when a reliable answer is unavailable.

**Scope.** The prototype offers English and ten Indian languages. Speech availability depends on provider configuration, and answer and speech quality require further evaluation across languages. Citation and evidence checks support transparency but do not guarantee factual correctness.
