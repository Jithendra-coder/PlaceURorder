"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, Bot, Send } from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { Drawer } from "@astryxdesign/core/Drawer";
import { Grid } from "@astryxdesign/core/Grid";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Spinner } from "@astryxdesign/core/Spinner";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { NoticeBanner } from "@/components/dashboard/kit";
import { api } from "@/services/api";

// Ask AI: a logo-only floating trigger in the corner. Opening it reveals the assistant in an end-side drawer,
// so nothing else on the page is covered until the owner asks for it.

const suggestions = [
  "How can I grow my menu sales?",
  "Show my current menu",
  "How many orders were placed in the last 24 hours?",
  "How do I test and publish my kiosk?",
];

type AskResponse = Awaited<ReturnType<typeof api.askAssistant>>;

export function AskAiPanel({ businessId }: { businessId: string | null }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ businessId: string | null; text: string }>({ businessId: null, text: "" });
  const [asked, setAsked] = useState<{ businessId: string; question: string; result: AskResponse | null } | null>(null);
  const [error, setError] = useState<{ businessId: string; message: string } | null>(null);
  const [activeRequest, setActiveRequest] = useState<{ id: number; businessId: string } | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const question = draft.businessId === businessId ? draft.text : "";
  const loading = activeRequest?.businessId === businessId;
  const visibleAsked = asked?.businessId === businessId ? asked : null;
  const visibleError = error?.businessId === businessId ? error.message : "";

  const close = useCallback(() => {
    requestController.current?.abort();
    requestController.current = null;
    setActiveRequest(null);
    setAsked(null);
    setError(null);
    setDraft({ businessId: null, text: "" });
    setOpen(false);
  }, []);

  // A different business never inherits the previous conversation or an in-flight request.
  useEffect(() => {
    requestController.current?.abort();
    requestController.current = null;
    return () => requestController.current?.abort();
  }, [businessId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = question.trim();
    if (!businessId || prompt.length < 3 || loading) return;
    setAsked({ businessId, question: prompt, result: null });
    setDraft({ businessId, text: "" });
    setError(null);
    const controller = new AbortController();
    const activeId = ++requestId.current;
    requestController.current = controller;
    setActiveRequest({ id: activeId, businessId });
    try {
      const result = await api.askAssistant(businessId, prompt, { signal: controller.signal });
      if (requestController.current === controller) setAsked({ businessId, question: prompt, result });
    } catch {
      if (!controller.signal.aborted) {
        setDraft({ businessId, text: prompt });
        setError({ businessId, message: "Couldn't retrieve your business data. Please try again." });
      }
    } finally {
      if (requestController.current === controller) requestController.current = null;
      setActiveRequest((current) => (current?.id === activeId ? null : current));
    }
  }

  function show() {
    setAsked(null);
    setError(null);
    setDraft({ businessId, text: "" });
    setOpen(true);
  }

  return (
    <>
      <Layout height="auto" style={{ position: "fixed", top: "auto", left: "auto", right: 24, bottom: 24, height: "auto", minHeight: 0, width: "auto", zIndex: 40 }}>
        <LayoutContent padding={0}>
          <IconButton
            label="Ask AI"
            icon={<Bot size={20} aria-hidden="true" />}
            variant="primary"
            size="lg"
            elevation="med"
            isDisabled={!businessId}
            onClick={() => (open ? close() : show())}
          />
        </LayoutContent>
      </Layout>

      <Drawer isOpen={open} onOpenChange={(next) => { if (!next) close(); }} label="Ask AI" side="end" width={460} padding={5}>
        <VStack gap={5}>
          <HStack gap={3} vAlign="center">
            <Bot size={22} aria-hidden="true" />
            <VStack gap={1}>
              <Heading level={2} weight="semibold">Ask AI</Heading>
              <Text type="supporting" color="secondary">Ask about your menu, growth, orders, sales and setup.</Text>
            </VStack>
          </HStack>

          <Divider />

          {visibleError && <NoticeBanner tone="danger" title="We could not get that answer" description={visibleError} role="alert" />}

          {visibleAsked ? (
            <VStack gap={4}>
              <Card padding={4} elevation="low">
                <VStack gap={1}>
                  <Text type="label" color="secondary">You asked</Text>
                  <Text type="body" color="primary">{visibleAsked.question}</Text>
                </VStack>
              </Card>

              {loading ? (
                <HStack gap={2} vAlign="center">
                  <Spinner />
                  <Text type="supporting" color="secondary">Looking up current business data…</Text>
                </HStack>
              ) : visibleAsked.result && (
                <VStack gap={3}>
                  <Card padding={5} elevation="low">
                    <VStack gap={3}>
                      <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap">
                        <HStack gap={2} vAlign="center">
                          <Bot size={18} aria-hidden="true" />
                          <Text type="label">PlaceURorder assistant</Text>
                        </HStack>
                        <Badge variant={visibleAsked.result.sources.length ? "success" : "neutral"} label={visibleAsked.result.sources.length ? "Source-backed" : "No source matched"} />
                      </HStack>
                      <Text type="body" color="primary">{visibleAsked.result.text}</Text>
                      {visibleAsked.result.results.length > 0 && (
                        <Grid columns={{ minWidth: 180, repeat: "fit" }} gap={3}>
                          {visibleAsked.result.results.map((result, index) => (
                            <Card key={`${result.title}-${index}`} padding={3}>
                              <VStack gap={2}>
                                <HStack gap={2} vAlign="center" hAlign="between">
                                  <Text type="label">{result.title}</Text>
                                  {result.value && <Text type="label" color="primary">{result.value}</Text>}
                                </HStack>
                                {result.fields.map((field) => (
                                  <HStack key={field.label} gap={2} vAlign="center" hAlign="between">
                                    <Text type="supporting" color="secondary">{field.label}</Text>
                                    <Text type="supporting" color="primary">{field.value}</Text>
                                  </HStack>
                                ))}
                              </VStack>
                            </Card>
                          ))}
                        </Grid>
                      )}
                      <Text type="supporting" color="secondary">
                        {`Updated ${new Date(visibleAsked.result.as_of).toLocaleString()}${visibleAsked.result.has_more ? " · Showing a partial result" : ""}`}
                      </Text>
                    </VStack>
                  </Card>

                  {visibleAsked.result.sources.length > 0 && (
                    <VStack gap={2}>
                      {visibleAsked.result.sources.map((source, index) => {
                        const href = source.href?.startsWith("/") ? source.href : null;
                        return (
                          <Card key={`${source.kind}-${source.title}-${index}`} padding={3}>
                            <VStack gap={2}>
                              <HStack gap={2} vAlign="center" hAlign="between">
                                <VStack gap={0}>
                                  <Text type="label">{source.title}</Text>
                                  <Text type="supporting" color="secondary">
                                    {source.kind === "live" ? "Live business data" : source.kind === "policy" ? `Help guide · v${source.version ?? "current"}` : "Access note"}
                                  </Text>
                                </VStack>
                                {href && <Button label="Open" variant="ghost" size="sm" href={href} endContent={<ArrowUpRight size={14} aria-hidden="true" />} />}
                              </HStack>
                              {source.excerpt && <Text type="supporting" color="secondary">{source.excerpt}</Text>}
                            </VStack>
                          </Card>
                        );
                      })}
                    </VStack>
                  )}
                </VStack>
              )}
            </VStack>
          ) : (
            <VStack gap={4}>
              <Text type="body" color="secondary">Get source-backed help and menu insights from your business data.</Text>
              <VStack gap={2}>
                {suggestions.map((suggestion) => (
                  <Button key={suggestion} label={suggestion} variant="secondary" size="sm" width="100%" onClick={() => setDraft({ businessId, text: suggestion })} />
                ))}
              </VStack>
              <Text type="supporting" color="secondary">
                When Gemini is enabled, your question, relevant help text, and aggregated sales or item metrics may be sent to Google. Customer details are excluded.
              </Text>
            </VStack>
          )}

          <Divider />

          <form onSubmit={submit}>
            <HStack gap={2} vAlign="end">
              <TextArea
                label="Ask about PlaceURorder or your business"
                isLabelHidden
                value={question}
                onChange={(value) => setDraft({ businessId, text: value })}
                placeholder="Ask about your menu, orders, sales…"
                maxLength={1000}
                rows={2}
                isDisabled={loading || !businessId}
                width="100%"
              />
              <IconButton
                label="Send question"
                type="submit"
                variant="primary"
                icon={<Send size={18} aria-hidden="true" />}
                isLoading={loading}
                isDisabled={loading || question.trim().length < 3 || !businessId}
              />
            </HStack>
          </form>
        </VStack>
      </Drawer>
    </>
  );
}
