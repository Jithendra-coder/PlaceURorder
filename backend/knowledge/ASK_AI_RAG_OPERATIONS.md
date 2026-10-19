# MenuTap Ask AI: RAG Design and Operations

Status: implemented in the backend; database migration and knowledge indexing are required before pgvector retrieval is active.
Owner: MenuTap engineering and product owner
Scope: read-only product-help retrieval for the dashboard Ask AI feature

## 1. Goal and boundaries

Retrieval-augmented generation (RAG) lets Ask AI find relevant, approved product documentation and use those passages to answer a help question. It is intended for product guidance such as kiosk setup, menu management, testing, publishing, roles, and troubleshooting.

RAG is not the source of truth for live merchant data. Sales totals, order counts, menu catalog details, and business setup status continue to use the existing backend methods, tenant-scoped SQL, and role checks. These live records are not added to the vector corpus and are not sent to Gemini. Ask AI does not gain write access or arbitrary SQL/API access.

The current corpus is the versioned [`placeurorder-help-policy.md`](placeurorder-help-policy.md). Despite its filename, that guide is product help and is not the legal Terms and Conditions or Privacy Policy.

## 2. Request flow

1. The authenticated API checks the user's membership in the selected business and applies the existing request rate limit.
2. Known business-data questions are classified and handled by their existing read-only backend functions. They return before any embedding or Gemini request.
3. When `GEMINI_API_KEY` is configured, the backend asks Gemini Embedding for a help-question vector using the same model and dimensions as the indexed guide.
4. With a query vector, a parameterized Postgres query filters to the current guide key, document version, embedding model, and active chunks, then orders by pgvector cosine distance.
5. The backend accepts up to three sufficiently similar chunks as sources. Without a key, without a current index, or when semantic retrieval fails, it uses the local keyword-matched guide passages.
6. If `GEMINI_API_KEY` is configured, the generation model receives only the question and selected help excerpts. It has no tools or business-data access.
7. If vector lookup or Gemini generation is unavailable, Ask AI falls back to local keyword-matched guide text. A missing provider must not turn into a fabricated success message.

## 3. Embeddings and Postgres storage

- **Embedding model:** `gemini-embedding-001`.
- **Vector size:** 768 dimensions, normalized before storage and comparison.
- **Task types:** guide content uses `RETRIEVAL_DOCUMENT`; help questions use `RETRIEVAL_QUERY`.
- **Distance:** cosine distance (`<=>`) in the `extensions` schema.
- **Chunking:** guide sections are split into bounded chunks with a small overlap; each chunk carries a stable section key, SHA-256 content hash, title, and source version.
- **Incremental sync:** unchanged chunks reuse their existing embedding. Changed chunks are re-embedded. Removed chunks from this guide are removed during a successful sync. The indexer closes its read transaction before calling Google and updates rows in one database transaction.
- **Version safety:** retrieval only uses chunks whose stored document version matches the checked-in guide version. If the guide changes before indexing is rerun, stale vectors are ignored and local retrieval remains available.

The table is `public.assistant_knowledge_chunks`. Row-level security is enabled; direct Data API access is revoked for `PUBLIC`, `anon`, and `authenticated`. The trusted backend connects directly to Postgres. Do not grant browser clients access to this table or expose the database credential.

This guide is a small corpus, so exact cosine ranking is used rather than an approximate HNSW index. Exact search avoids recall surprises and is appropriate until the knowledge corpus is large enough for measured vector-query latency to justify ANN indexing. If adding HNSW later, benchmark recall and account for metadata-filtered search behavior before setting the index as the default.

## 4. Apply and index

### Hosted Supabase database

Review and apply [`20261015122111_assistant_pgvector_rag.sql`](../../supabase/migrations/20261015122111_assistant_pgvector_rag.sql) through the project's normal, approved migration workflow. Confirm the target project and take the normal backup/checkpoint before applying schema changes. This implementation turn does not apply the migration to a hosted database.

After the migration is applied, run the indexer from the backend directory in an environment with the intended `DATABASE_URL` and backend-only `GEMINI_API_KEY` configured:

```powershell
Set-Location backend
python index_assistant_knowledge.py
```

The command prints the number of chunks indexed and new embeddings generated. It is safe to rerun: identical chunks do not incur another embedding request. Verify the database contains active rows for source key `placeurorder-help-policy`, the guide's current version, and model `gemini-embedding-001` before enabling vector-backed help traffic.

### Local Podman database

The local Compose database builds pgvector 0.8.7 into the project's existing `postgres:16-alpine` base. Keeping the same Postgres major version and base image avoids changing the runtime underneath an existing local volume. A newly initialized database enables the extension and creates the protected table from `backend/postgres_schema.sql`. The Docker entrypoint only runs bootstrap SQL when its data directory is first initialized; changing the image does not rerun bootstrap on an existing volume. For an existing local volume, apply the tracked migration to that local database using a local administrator connection, then run the indexer. Do not delete the volume to force initialization; it may contain user data.

## 5. Security and privacy controls

- Authenticate and authorize the user before retrieval. Do not treat retrieval as authorization.
- Keep the document corpus limited to approved, non-tenant-specific product help. If merchant-specific documents are added, include a verified business/tenant filter in every retrieval query and enforce it server-side; do not rely on model instructions.
- Keep `GEMINI_API_KEY` and `DATABASE_URL` on the backend only. Never place them in frontend variables or return them in errors/logs.
- With `GEMINI_API_KEY` configured, the help question is sent to Google's embedding endpoint. If generation is enabled, the question and retrieved excerpts are also sent to the configured Gemini model. Do not invite customer, payment, credential, or other sensitive data in questions.
- `store: false` on the generation request prevents interaction-state storage by that request; it is not a guarantee of zero provider retention. Review the provider terms and MenuTap Privacy Policy for the account tier in use.
- Treat the question and retrieved text as untrusted input. The generation instruction requires source-grounded answers, but backend authorization and the narrow corpus remain the actual security boundary.
- Log failure type and status only. Do not log API keys, full questions, retrieved customer data, or complete provider response bodies.

## 6. Relevance, quality, and maintenance

The runtime returns at most three chunks and currently uses a cosine-similarity cutoff of `0.45`. That cutoff is an initial operating value, not a proven quality guarantee. Before expanding the corpus or changing the cutoff, maintain a reviewed set of realistic questions with expected source sections. Check that the right passage is retrieved for paraphrases, misspellings, short questions, and similar-but-different topics; also check that unrelated questions produce no match.

When product behavior changes:

1. Update and review the product-help guide; do not write claims that the shipped code does not support.
2. Bump the guide version and review date.
3. Run the assistant tests.
4. Apply any needed database migration, run the indexer, and verify current-version rows.
5. Smoke-test source titles, extractive fallback, Gemini failure, and live-data questions.

Provider, database, or indexing failure must leave live read-only business answers functional and product-help answers grounded in local guide text. Do not add autonomous actions, arbitrary SQL, or business-record embeddings as part of this RAG feature.
