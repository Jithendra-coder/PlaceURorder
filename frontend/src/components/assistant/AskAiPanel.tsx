"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { BookOpen, LoaderCircle, MessageCircleQuestion, Send, X } from "lucide-react";
import { api } from "@/services/api";

const suggestions = [
  "How do I test and publish my kiosk?",
  "Show my current menu",
  "How many orders were placed in the last 24 hours?",
];

type AskResponse = Awaited<ReturnType<typeof api.askAssistant>>;

export function AskAiPanel({ businessId }: { businessId: string | null }) {
  const [open, setOpen] = useState(false);
  const [draftQuestion, setDraftQuestion] = useState<{ businessId: string | null; text: string }>({ businessId: null, text: "" });
  const [asked, setAsked] = useState<{ businessId: string; question: string; result: AskResponse | null } | null>(null);
  const [error, setError] = useState<{ businessId: string; message: string } | null>(null);
  const [activeRequest, setActiveRequest] = useState<{ id: number; businessId: string } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestController = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const question = draftQuestion.businessId === businessId ? draftQuestion.text : "";
  const loading = activeRequest?.businessId === businessId;
  const visibleAsked = asked?.businessId === businessId ? asked : null;
  const visibleError = error?.businessId === businessId ? error.message : "";

  useEffect(() => {
    return () => {
      requestController.current?.abort();
      requestController.current = null;
    };
  }, [businessId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
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
    } catch (cause) {
      if (!controller.signal.aborted) {
        setDraftQuestion({ businessId, text: prompt });
        setError({ businessId, message: cause instanceof Error ? cause.message : "Ask AI is temporarily unavailable." });
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

  return (
    <>
      <button type="button" className="mt-ai-trigger" onClick={show} disabled={!businessId} aria-label="Ask AI" aria-haspopup="dialog" aria-expanded={open}>
        <MessageCircleQuestion size={17} aria-hidden="true" />
        <span>Ask AI</span>
      </button>
      <dialog
        ref={dialogRef}
        className="mt-ai-dialog"
        aria-labelledby="mt-ai-title"
        onCancel={(event) => { event.preventDefault(); close(); }}
        onClick={(event) => { if (event.target === event.currentTarget) close(); }}
      >
        <header className="mt-ai-header">
          <div><span className="mt-ai-mark"><MessageCircleQuestion size={18} aria-hidden="true" /></span><div><h2 id="mt-ai-title">Ask AI</h2><p>Answers grounded in your product guide and business data</p></div></div>
          <button type="button" className="mt-ai-close" onClick={close} aria-label="Close Ask AI"><X size={19} /></button>
        </header>
        <p className="mt-ai-disclosure">Gemini is optional. When enabled, your question and matching authorized business facts are sent to Google for a grounded draft under Google’s data-use terms. The model has no database or app tools; live lookups remain read-only and role-checked. Don’t include customer, payment, or secret data.</p>
        <div className="mt-ai-body" aria-live="polite" aria-busy={loading}>
          {visibleAsked ? <section className="mt-ai-result">
            <p className="mt-ai-question">{visibleAsked.question}</p>
            {loading ? <p className="mt-ai-loading"><LoaderCircle size={16} className="mt-ai-spinner" /> Searching approved sources…</p> : visibleError ? <p className="mt-ai-error" role="alert">{visibleError}</p> : visibleAsked.result && <>
              <p className="mt-ai-mode">{visibleAsked.result.mode === "gemini" ? `Gemini-generated from cited sources · ${visibleAsked.result.generated_model?.replace(/^models\//, "")}` : "Extractive response from the cited sources."}</p>
              <p className="mt-ai-answer">{visibleAsked.result.answer}</p>
              {visibleAsked.result.sources.length ? <ol className="mt-ai-sources">{visibleAsked.result.sources.map((source, index) => <li key={`${source.kind}-${source.title}-${index}`}>
                <div><BookOpen size={14} aria-hidden="true" /><strong>{source.title}</strong><small>{source.kind === "policy" ? `Product guide · v${source.version}` : `Live business data · ${new Date(source.as_of || visibleAsked.result!.retrieved_at).toLocaleString()}`}</small></div>
                <p>{source.excerpt}</p>
              </li>)}</ol> : <p className="mt-ai-empty">No matching source was found. Try one of the suggested questions.</p>}
            </>}
          </section> : <div className="mt-ai-welcome"><span>What would you like to find?</span><div>{suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => setDraftQuestion({ businessId, text: suggestion })}>{suggestion}</button>)}</div></div>}
        </div>
        <form className="mt-ai-form" onSubmit={submit}>
          <label className="mt-ai-sr-only" htmlFor="mt-ai-question">Ask about PlaceURorder or your business</label>
          <textarea id="mt-ai-question" value={question} onChange={(event) => setDraftQuestion({ businessId, text: event.target.value })} placeholder="Ask about setup, your menu, orders…" maxLength={1000} rows={2} disabled={loading || !businessId} />
          <button type="submit" aria-label="Search sources" disabled={loading || question.trim().length < 3 || !businessId}>{loading ? <LoaderCircle size={17} className="mt-ai-spinner" /> : <Send size={17} />}</button>
        </form>
        <p className="mt-ai-footer">Don’t include customer personal data, card details, passwords, or secrets.</p>
      </dialog>
    </>
  );
}
