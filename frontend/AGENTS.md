# PlaceURorder frontend boundaries

- `src/app/globals.css` is the only application stylesheet.
- Keep preview, test, live, and device kiosks on `KioskRuntime`.
- Keep exactly three layout implementations: side navigation, top navigation, and category first.
- Persist business state through `src/services/api.ts`; do not add browser-storage fallbacks or mock production data.
- Read the matching Next 16 guide in `node_modules/next/dist/docs/` before using a framework API.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
