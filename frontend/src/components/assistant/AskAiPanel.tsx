"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUpRight, Bot, LoaderCircle, Send, ShieldCheck, X } from "lucide-react";
import { api } from "@/services/api";

const suggestions = [
  "Show my current menu",
  "How many orders were placed in the last 24 hours?",
  "How do I test and publish my kiosk?",
];

type AskResponse = Awaited<ReturnType<typeof api.askAssistant>>;

export function AskAiPanel({ businessId }: { businessId: string | null }) {
  const [open, setOpen] = useState(false);
  const [draftQuestion, setDraftQuestion] = useState<{ businessId: string | null; text: string }>({ businessId: null, text: "" });
  const [asked, setAsked] = useState<{ businessId: string; question: string; result: AskResponse | null } | null>(null);
  const [error, setError] = useState<{ businessId: string; message: string } | null>(null);
  const [activeRequest, setActiveRequest] = useState<{ id: number; businessId: string } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const requestController = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const question = draftQuestion.businessId === businessId ? draftQuestion.text : "";
  const loading = activeRequest?.businessId === businessId;
  const visibleAsked = asked?.businessId === businessId ? asked : null;
  const visibleError = error?.businessId === businessId ? error.message : "";

  useEffect(() => {
    requestController.current?.abort();
    requestController.current = null;
    return () => requestController.current?.abort();
  }, [businessId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.show();
      textareaRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = question.trim();
    if (!businessId || prompt.length < 3 || loading) return;
    setAsked({ businessId, question: prompt, result: null });
    setDraftQuestion({ businessId, text: "" });
    setError(null);
    const controller = new AbortController();
    const activeId = ++requestId.current;
    requestController.current = controller;
    setActiveRequest({ id: activeId, businessId });
    try {
      const result = await api.askAssistant(businessId, prompt, controller.signal);
      if (requestController.current === controller) setAsked({ businessId, question: prompt, result });
    } catch {
      if (!controller.signal.aborted) {
        setDraftQuestion({ businessId, text: prompt });
        setError({ businessId, message: "Couldn't retrieve your business data. Please try again." });
      }
    } finally {
      if (requestController.current === controller) requestController.current = null;
      setActiveRequest((current) => current?.id === activeId ? null : current);
    }
  }

  function close() {
    requestController.current?.abort();
    requestController.current = null;
    setActiveRequest(null);
    setAsked(null);
    setError(null);
    setDraftQuestion({ businessId: null, text: "" });
    setOpen(false);
  }

  function show() {
    setAsked(null);
    setError(null);
    setDraftQuestion({ businessId, text: "" });
    setOpen(true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <>
      <button ref={triggerRef} type="button" className="mt-ai-trigger" onClick={show} disabled={!businessId} aria-label="Ask AI" aria-haspopup="dialog" aria-controls="mt-ai-dialog" aria-expanded={open}>
        <Bot size={18} aria-hidden="true" />
        <span>Ask AI</span>
      </button>
      <dialog
        ref={dialogRef}
        id="mt-ai-dialog"
        className="mt-ai-dialog"
        aria-labelledby="mt-ai-title"
        onCancel={(event) => { event.preventDefault(); close(); }}
        onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(); } }}
        onClose={() => triggerRef.current?.focus()}
      >
        <header className="mt-ai-header">
          <div className="mt-ai-heading">
            <span className="mt-ai-mark"><Bot size={20} aria-hidden="true" /></span>
            <span><h2 id="mt-ai-title">Ask AI</h2><p>Ask about your menu, orders, sales, and setup</p></span>
          </div>
          <button type="button" className="mt-ai-close" onClick={close} aria-label="Close Ask AI"><X size={19} /></button>
        </header>
        <div className="mt-ai-main">
          <div className="mt-ai-body" aria-live="polite" aria-busy={loading}>
            {visibleAsked ? <section className="mt-ai-conversation">
              <p className="mt-ai-question">{visibleAsked.question}</p>
              {loading ? <p className="mt-ai-loading"><LoaderCircle size={17} className="mt-ai-spinner" /> Looking up current business data…</p> : visibleError ? <p className="mt-ai-error" role="alert">{visibleError}</p> : visibleAsked.result && <>
                <article className="mt-ai-answer-card">
                  <header className="mt-ai-answer-heading"><Bot size={17} aria-hidden="true" /><strong>MenuTap assistant</strong><span>{visibleAsked.result.sources.length ? "Source-backed" : "No source matched"}</span></header>
                  <p className="mt-ai-answer">{visibleAsked.result.text}</p>
                  {visibleAsked.result.results.length > 0 && <div className="mt-ai-result-grid">
                    {visibleAsked.result.results.map((result, index) => <article className="mt-ai-result-card" key={`${result.title}-${index}`}>
                      <div className="mt-ai-result-title"><h3>{result.title}</h3>{result.value && <strong>{result.value}</strong>}</div>
                      {result.fields.length > 0 && <dl>{result.fields.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>}
                    </article>)}
                  </div>}
                  <footer className="mt-ai-answer-meta">
                    <span>Updated {new Date(visibleAsked.result.as_of).toLocaleString()}</span>
                    {visibleAsked.result.has_more && <span>Showing a partial result</span>}
                  </footer>
                </article>
                {visibleAsked.result.sources.length > 0 && <ul className="mt-ai-sources">
                  {visibleAsked.result.sources.map((source, index) => {
                    const href = source.href?.startsWith("/") ? source.href : null;
                    return <li key={`${source.kind}-${source.title}-${index}`}>
                      <span><strong>{source.title}</strong><small>{source.kind === "live" ? "Live business data" : source.kind === "policy" ? `Help guide · v${source.version ?? "current"}` : "Access note"}</small></span>
                      {href && <Link href={href}>Open <ArrowUpRight size={14} aria-hidden="true" /></Link>}
                      {source.excerpt && <p>{source.excerpt}</p>}
                    </li>;
                  })}
                </ul>}
              </>}
            </section> : <div className="mt-ai-welcome">
              <span className="mt-ai-welcome-icon"><Bot size={23} aria-hidden="true" /></span>
              <h3>What can I help you find?</h3>
              <p>Get clear answers from your live, access-checked business data.</p>
              <div className="mt-ai-suggestions">{suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => setDraftQuestion({ businessId, text: suggestion })}>{suggestion}</button>)}</div>
            </div>}
          </div>
        </div>
        <div className="mt-ai-composer">
          <form className="mt-ai-form" onSubmit={submit}>
            <label className="mt-ai-sr-only" htmlFor="mt-ai-question">Ask about PlaceURorder or your business</label>
            <textarea ref={textareaRef} id="mt-ai-question" value={question} onChange={(event) => setDraftQuestion({ businessId, text: event.target.value })} onKeyDown={handleKeyDown} placeholder="Ask about your menu, orders, sales…" maxLength={1000} rows={1} disabled={loading || !businessId} />
            <button type="submit" aria-label="Send question" disabled={loading || question.trim().length < 3 || !businessId}>{loading ? <LoaderCircle size={18} className="mt-ai-spinner" /> : <Send size={18} />}</button>
          </form>
          <div className="mt-ai-composer-meta">
            <span><ShieldCheck size={13} aria-hidden="true" /> Read-only · role-checked · source-linked</span>
            <span>Enter to send · Shift+Enter for a new line</span>
          </div>
          <p className="mt-ai-privacy">If Gemini is enabled, your question and matching help text may be sent to Google; live business lookups stay in MenuTap.</p>
        </div>
      </dialog>
    </>
  );
}
