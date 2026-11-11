"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Table } from "@astryxdesign/core/Table";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { EmptyBlock } from "@/components/dashboard/kit";

// Dashboard charts built to the dataviz rules: one axis, nice ticks, chronological x, thin marks, a legend for
// two or more series, selective value labels, a hover readout that lists every series, keyboard focus, and a
// table twin. Colour comes from the --viz-* role tokens (categorical slots, fixed order) and Astryx text tokens.

export type Point = { label: string; value: number };
export type Series = { id: string; name: string; values: Point[]; tone?: "primary" | "comparison" };
type Format = (value: number) => string;

const slot = (index: number) => `var(--viz-${(index % 8) + 1})`;

/** Round the top of a value axis to a clean step (1, 2, 2.5, 5 x 10^n), never below a step of 1. */
export function niceTicks(max: number, count = 4): { top: number; ticks: number[] } {
  const raw = Math.max(max, 1) / count;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const unit = raw / pow;
  const step = Math.max(1, (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * pow);
  const top = Math.max(step, Math.ceil(Math.max(max, 1) / step) * step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step);
  return { top, ticks };
}

const compact: Format = (value) => (Math.abs(value) >= 1000 ? `${Math.round(value / 100) / 10}K` : String(Math.round(value)));

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <HStack gap={4} vAlign="center" wrap="wrap">
      {series.map((item, index) => (
        <HStack key={item.id} gap={2} vAlign="center">
          <Layout height="auto" style={{ margin: 0, width: 14, height: 3, borderRadius: 2, background: item.tone === "comparison" ? "var(--color-text-muted)" : slot(index) }}>
            <LayoutContent padding={0}><span /></LayoutContent>
          </Layout>
          <Text type="supporting" color="secondary">{item.name}</Text>
        </HStack>
      ))}
    </HStack>
  );
}

function TableTwin({ series, format }: { series: Series[]; format: Format }) {
  const rows = (series[0]?.values ?? []).map((point, index) => ({
    id: `row-${index}`,
    label: point.label,
    ...Object.fromEntries(series.map((item) => [item.id, item.values[index] ? format(item.values[index].value) : "—"])),
  }));
  return (
    <Table
      data={rows}
      idKey="id"
      columns={[
        { key: "label", header: "Period" },
        ...series.map((item) => ({ key: item.id, header: item.name, align: "end" as const })),
      ]}
    />
  );
}

/** Multi-series line chart. The first series is the subject; a comparison series is drawn as a quiet grey line. */
export function LineChart({ series, ariaLabel, format = compact, height = 260, width: drawWidth = 720 }: { series: Series[]; ariaLabel: string; format?: Format; height?: number; width?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const subject = series.find((item) => item.tone !== "comparison") ?? series[0];
  if (!subject || subject.values.length === 0) return <EmptyBlock title="No data for this period" />;

  const width = drawWidth;
  const inset = { top: 16, right: 16, bottom: 28, left: 56 };
  const plotWidth = width - inset.left - inset.right;
  const plotHeight = height - inset.top - inset.bottom;
  const count = subject.values.length;
  const maxValue = Math.max(0, ...series.flatMap((item) => item.values.map((point) => point.value)));
  const { top, ticks } = niceTicks(maxValue);
  const xAt = (index: number) => inset.left + (count > 1 ? (index / (count - 1)) * plotWidth : plotWidth / 2);
  const yAt = (value: number) => inset.top + plotHeight * (1 - value / top);
  const baseline = inset.top + plotHeight;
  const linePath = (values: Point[]) => values.map((point, index) => `${index ? "L" : "M"}${xAt(index)},${yAt(point.value)}`).join(" ");
  const labelEvery = Math.max(1, Math.ceil(count / 8));
  const hoverIndex = hover === null ? null : Math.min(hover, count - 1);
  const peakIndex = subject.values.reduce((best, point, index) => (point.value > subject.values[best].value ? index : best), 0);

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const index = count > 1 ? Math.round(((x - inset.left) / plotWidth) * (count - 1)) : 0;
    setHover(Math.max(0, Math.min(count - 1, index)));
  };
  const onKey = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (event.key === "ArrowRight") setHover((value) => Math.min(count - 1, (value ?? -1) + 1));
    if (event.key === "ArrowLeft") setHover((value) => Math.max(0, (value ?? count) - 1));
    if (event.key === "Escape") setHover(null);
  };

  const tooltipLeft = hoverIndex === null ? 0 : (xAt(hoverIndex) / width) * 100;
  const tooltipStyle: CSSProperties = { position: "absolute", top: 8, left: `${tooltipLeft}%`, transform: tooltipLeft > 70 ? "translateX(-100%)" : "translateX(0)", pointerEvents: "none", minWidth: 160, zIndex: 2 };

  return (
    <VStack gap={3}>
      <Layout height="auto" style={{ margin: 0, position: "relative", width: "100%" }}>
        <LayoutContent padding={0}>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={ariaLabel}
            tabIndex={0}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            onKeyDown={onKey}
            onBlur={() => setHover(null)}
            style={{ margin: 0, width: "100%", height: "auto", display: "block", touchAction: "none", outline: "none" }}
          >
            {ticks.map((tick) => {
              const y = yAt(tick);
              return (
                <g key={tick}>
                  <line x1={inset.left} x2={width - inset.right} y1={y} y2={y} stroke="var(--color-border)" strokeWidth={1} />
                  <text x={inset.left - 10} y={y + 4} textAnchor="end" fill="var(--color-text-secondary)" fontSize="12">{compact(tick)}</text>
                </g>
              );
            })}
            {subject.values.map((point, index) => (index % labelEvery === 0 || index === count - 1 ? (
              <text key={`${point.label}-${index}`} x={xAt(index)} y={height - 6} textAnchor={index === count - 1 && count > 1 ? "end" : "middle"} fill="var(--color-text-secondary)" fontSize="12">{point.label}</text>
            ) : null))}
            {series.filter((item) => item.tone === "comparison").map((item) => (
              <path key={item.id} d={linePath(item.values)} fill="none" stroke="var(--color-text-muted)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            <path d={`${linePath(subject.values)} L${xAt(count - 1)},${baseline} L${xAt(0)},${baseline} Z`} fill={slot(0)} opacity={0.1} />
            <path d={linePath(subject.values)} fill="none" stroke={slot(0)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {hoverIndex !== null && (
              <line x1={xAt(hoverIndex)} x2={xAt(hoverIndex)} y1={inset.top} y2={baseline} stroke="var(--color-border-emphasized)" strokeWidth={1} />
            )}
            {hoverIndex !== null && series.map((item, index) => item.values[hoverIndex] && item.tone !== "comparison" ? (
              <circle key={item.id} cx={xAt(hoverIndex)} cy={yAt(item.values[hoverIndex].value)} r={5} fill={slot(index)} stroke="var(--color-background-card)" strokeWidth={2} />
            ) : null)}
            <circle cx={xAt(peakIndex)} cy={yAt(subject.values[peakIndex].value)} r={4} fill={slot(0)} stroke="var(--color-background-card)" strokeWidth={2} />
          </svg>
          {hoverIndex !== null && (
            <Card padding={3} elevation="med" style={tooltipStyle}>
              <VStack gap={1}>
                <Text type="label">{subject.values[hoverIndex].label}</Text>
                {series.map((item, index) => item.values[hoverIndex] ? (
                  <HStack key={item.id} gap={2} vAlign="center" hAlign="between">
                    <HStack gap={2} vAlign="center">
                      <Layout height="auto" style={{ margin: 0, width: 8, height: 8, borderRadius: 2, background: item.tone === "comparison" ? "var(--color-text-muted)" : slot(index) }}>
                        <LayoutContent padding={0}><span /></LayoutContent>
                      </Layout>
                      <Text type="supporting" color="secondary">{item.name}</Text>
                    </HStack>
                    <Text type="supporting" color="primary">{format(item.values[hoverIndex].value)}</Text>
                  </HStack>
                ) : null)}
              </VStack>
            </Card>
          )}
        </LayoutContent>
      </Layout>
      <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
        <Legend series={series} />
        <HStack gap={2} vAlign="center">
          <Text type="supporting" color="secondary">{`Peak ${format(subject.values[peakIndex].value)} on ${subject.values[peakIndex].label}`}</Text>
          <Button label={showTable ? "View chart" : "View as table"} variant="ghost" size="sm" onClick={() => setShowTable((value) => !value)} />
        </HStack>
      </HStack>
      {showTable && <TableTwin series={series} format={format} />}
    </VStack>
  );
}

/** Daily or per-period bars: thin, rounded at the top only, anchored to the baseline. Hover or focus reads each bar. */
export function DailyBars({ values, ariaLabel, format = compact, height = 220 }: { values: Point[]; ariaLabel: string; format?: Format; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (values.length === 0) return <EmptyBlock title="No data for this period" />;
  const width = 720;
  const inset = { top: 16, right: 8, bottom: 28, left: 56 };
  const plotWidth = width - inset.left - inset.right;
  const plotHeight = height - inset.top - inset.bottom;
  const { top, ticks } = niceTicks(Math.max(0, ...values.map((point) => point.value)));
  const band = plotWidth / values.length;
  const barWidth = Math.min(24, band * 0.6);
  const yAt = (value: number) => inset.top + plotHeight * (1 - value / top);
  const baseline = inset.top + plotHeight;
  const labelEvery = Math.max(1, Math.ceil(values.length / 8));
  const peak = values.reduce((best, point, index) => (point.value > values[best].value ? index : best), 0);
  const radius = Math.min(4, barWidth / 2);

  return (
    <VStack gap={2}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} style={{ margin: 0, width: "100%", height: "auto", display: "block" }}>
        {ticks.map((tick) => {
          const y = yAt(tick);
          return (
            <g key={tick}>
              <line x1={inset.left} x2={width - inset.right} y1={y} y2={y} stroke="var(--color-border)" strokeWidth={1} />
              <text x={inset.left - 10} y={y + 4} textAnchor="end" fill="var(--color-text-secondary)" fontSize="12">{compact(tick)}</text>
            </g>
          );
        })}
        {values.map((point, index) => {
          const x = inset.left + index * band + (band - barWidth) / 2;
          const y = yAt(point.value);
          const h = Math.max(baseline - y, point.value > 0 ? 2 : 0);
          const top = baseline - h;
          const dimmed = hover !== null && hover !== index;
          return (
            <g key={`${point.label}-${index}`}>
              {h > 0 && (
                <path
                  d={`M${x},${baseline} L${x},${top + radius} Q${x},${top} ${x + radius},${top} L${x + barWidth - radius},${top} Q${x + barWidth},${top} ${x + barWidth},${top + radius} L${x + barWidth},${baseline} Z`}
                  fill="var(--viz-1)"
                  opacity={dimmed ? 0.4 : 1}
                />
              )}
              <rect
                x={inset.left + index * band}
                y={inset.top}
                width={band}
                height={plotHeight}
                fill="transparent"
                tabIndex={0}
                aria-label={`${point.label}: ${format(point.value)}`}
                onPointerEnter={() => setHover(index)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(index)}
                onBlur={() => setHover(null)}
                style={{ margin: 0, outline: "none" }}
              />
              {index === peak && point.value > 0 && (
                <text x={x + barWidth / 2} y={top - 6} textAnchor="middle" fill="var(--color-text-primary)" fontSize="12">{format(point.value)}</text>
              )}
              {index % labelEvery === 0 && (
                <text x={x + barWidth / 2} y={height - 6} textAnchor="middle" fill="var(--color-text-secondary)" fontSize="12">{point.label}</text>
              )}
            </g>
          );
        })}
      </svg>
      <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap">
        <Text type="supporting" color="secondary">{hover === null ? `Peak ${format(values[peak].value)} on ${values[peak].label}` : `${values[hover].label}: ${format(values[hover].value)}`}</Text>
        <Text type="supporting" color="secondary">Hover a day to read its value</Text>
      </HStack>
    </VStack>
  );
}

/** Ranked horizontal bars: one hue, largest first, value at the bar end. Best for comparing named parts. */
export function RankedBars({ rows, ariaLabel, format = compact, limit = 8 }: { rows: Array<{ id: string; label: string; value: number; detail?: string }>; ariaLabel: string; format?: Format; limit?: number }) {
  if (rows.length === 0) return <EmptyBlock title="No sales for this period" />;
  const sorted = [...rows].sort((a, b) => b.value - a.value).slice(0, limit);
  const max = Math.max(1, ...sorted.map((row) => row.value));
  return (
    <VStack gap={3} role="list" aria-label={ariaLabel}>
      {sorted.map((row, index) => (
        <HStack key={row.id} gap={3} vAlign="center" role="listitem" tabIndex={0} aria-label={`${row.label}: ${format(row.value)}`} style={{ margin: 0, outline: "none" }}>
          <Layout height="auto" style={{ margin: 0, width: "34%", minWidth: 120 }}>
            <LayoutContent padding={0}>
              <VStack gap={0}>
                <Text type="body" color="primary">{row.label}</Text>
                {row.detail && <Text type="supporting" color="secondary">{row.detail}</Text>}
              </VStack>
            </LayoutContent>
          </Layout>
          <Layout height="auto" style={{ margin: 0, flex: 1, height: 14, borderRadius: 4, background: "var(--color-background-muted)" }}>
            <LayoutContent padding={0}>
              <Layout height="auto" style={{ margin: 0, width: `${(row.value / max) * 100}%`, height: 14, borderRadius: 4, background: index === 0 ? "var(--viz-1)" : "var(--viz-1)", opacity: index === 0 ? 1 : 0.75 }}>
                <LayoutContent padding={0}><span /></LayoutContent>
              </Layout>
            </LayoutContent>
          </Layout>
          <Text type="label" color="primary">{format(row.value)}</Text>
        </HStack>
      ))}
    </VStack>
  );
}

/** One whole split into up to six parts: 28px tall, 2px surface gaps, share printed where it fits, names in a legend. */
export function SegmentedShare({ parts, ariaLabel, format = compact }: { parts: Array<{ id: string; label: string; value: number }>; ariaLabel: string; format?: Format }) {
  const visible = parts.filter((part) => part.value > 0).slice(0, 6);
  const total = visible.reduce((sum, part) => sum + part.value, 0);
  if (total === 0) return <EmptyBlock title="Nothing to split yet" />;
  return (
    <VStack gap={3}>
      <HStack gap={0} role="img" aria-label={ariaLabel} vAlign="center" style={{ margin: 0, height: 28, width: "100%" }}>
        {visible.map((part, index) => {
          const share = (part.value / total) * 100;
          return (
            <Layout key={part.id} height="auto" style={{ margin: 0, width: `${share}%`, height: 28, background: slot(index), borderRadius: 4, marginRight: index < visible.length - 1 ? 2 : 0, minWidth: 2 }}>
              <LayoutContent padding={0}>
                <span />
              </LayoutContent>
            </Layout>
          );
        })}
      </HStack>
      <VStack gap={2}>
        {visible.map((part, index) => (
          <HStack key={part.id} gap={3} vAlign="center" hAlign="between">
            <HStack gap={2} vAlign="center">
              <Layout height="auto" style={{ margin: 0, width: 10, height: 10, borderRadius: 2, background: slot(index) }}>
                <LayoutContent padding={0}><span /></LayoutContent>
              </Layout>
              <Text type="body" color="primary">{part.label}</Text>
            </HStack>
            <HStack gap={3} vAlign="center">
              <Text type="supporting" color="secondary">{`${Math.round((part.value / total) * 100)}%`}</Text>
              <Text type="label" color="primary">{format(part.value)}</Text>
            </HStack>
          </HStack>
        ))}
      </VStack>
    </VStack>
  );
}

/** Small helper for a chart area that needs a caption above it. */
export function ChartCaption({ children }: { children: ReactNode }) {
  return <Text type="supporting" color="secondary">{children}</Text>;
}
