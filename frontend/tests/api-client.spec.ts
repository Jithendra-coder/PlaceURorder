import { expect, test } from "@playwright/test";
import { apiRequest } from "../src/lib/api";

test("API client converts non-JSON error responses into a controlled ApiError", async () => {
  const fetchImpl = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("Bad Gateway", { status: 502, headers: { "content-type": "text/html" } });
    await expect(apiRequest("/controlled-error", { auth: false })).rejects.toMatchObject({ message: "The service is temporarily unavailable. Please try again shortly.", status: 502 });
  } finally {
    globalThis.fetch = fetchImpl;
  }
});

test("API client rejects a non-JSON success response instead of returning it as data", async () => {
  const fetchImpl = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("<html>Proxy error</html>", { status: 200, headers: { "content-type": "text/html" } });
    await expect(apiRequest("/malformed-success", { auth: false })).rejects.toMatchObject({ message: "The service returned an unreadable response. Please try again.", status: 200 });
  } finally {
    globalThis.fetch = fetchImpl;
  }
});

test("API client timeout includes response body download", async () => {
  const fetchImpl = globalThis.fetch;
  try {
    globalThis.fetch = async (_input, init) => new Response(new ReadableStream({
      start(controller) {
        init?.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
      },
    }));
    await expect(apiRequest("/slow-body", { auth: false, timeoutMs: 10 })).rejects.toThrow("The server is taking too long to respond.");
  } finally {
    globalThis.fetch = fetchImpl;
  }
});

test("auth refresh request is bounded by the API timeout", async () => {
  const fetchImpl = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith("/auth/refresh")) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        });
      }
      return new Response(JSON.stringify({ detail: "Authentication required." }), { status: 401, headers: { "content-type": "application/json" } });
    };
    await expect(apiRequest("/protected", { timeoutMs: 10 })).rejects.toMatchObject({ message: "Authentication required.", status: 401 });
  } finally {
    globalThis.fetch = fetchImpl;
  }
});
