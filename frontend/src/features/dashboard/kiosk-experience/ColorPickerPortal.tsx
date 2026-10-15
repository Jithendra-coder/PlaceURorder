"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { X } from "lucide-react";

export type ColorPickerProps = {
  label: string;
  value: string;
  onCancel: () => void;
  onApply: (value: string) => void;
};

const PRESETS = ["#155EEF", "#079455", "#D92D20", "#7F56D9", "#E04F16", "#344054"];
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const safeHex = (value: string) => /^#[0-9a-f]{6}$/i.test(value) ? value : "#155EEF";
const hexToHsv = (hex: string) => {
  const value = safeHex(hex).slice(1); const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255); const [r, g, b] = channels; const max = Math.max(r, g, b); const min = Math.min(r, g, b); const delta = max - min; let h = 0;
  if (delta) h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { h: (h * 60 + 360) % 360, s: max ? delta / max : 0, v: max };
};
const hsvToHex = (h: number, s: number, v: number) => { const c = v * s; const x = c * (1 - Math.abs((h / 60) % 2 - 1)); const m = v - c; const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]; return `#${[r, g, b].map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, "0")).join("")}`; };

export function ColorPickerPortal({ label, value, onCancel, onApply }: ColorPickerProps) {
  const initial = useMemo(() => hexToHsv(value), [value]); const [hsv, setHsv] = useState(initial); const [position, setPosition] = useState({ top: 16, left: 16 }); const panelRef = useRef<HTMLDivElement>(null); const selector = label.startsWith("Primary") ? '[data-brand-color="primary"]' : '[data-brand-color="accent"]';
  useEffect(() => { const update = () => { const trigger = document.querySelector<HTMLElement>(selector); if (!trigger) return; const rect = trigger.getBoundingClientRect(); const width = Math.min(320, window.innerWidth - 32); setPosition({ left: Math.max(16, Math.min(rect.right + 10, window.innerWidth - width - 16)), top: Math.max(16, Math.min(rect.top, window.innerHeight - 510)) }); }; update(); window.addEventListener("resize", update); window.addEventListener("scroll", update, true); return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); }; }, [selector]);
  useEffect(() => { const handlePointer = (event: globalThis.PointerEvent) => { const target = event.target as Node; const trigger = document.querySelector<HTMLElement>(selector); if (!panelRef.current?.contains(target) && !trigger?.contains(target)) onCancel(); }; const handleKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } }; document.addEventListener("pointerdown", handlePointer); document.addEventListener("keydown", handleKey); return () => { document.removeEventListener("pointerdown", handlePointer); document.removeEventListener("keydown", handleKey); }; }, [onCancel, selector]);
  const temporary = hsvToHex(hsv.h, hsv.s, hsv.v); useEffect(() => { window.dispatchEvent(new CustomEvent("branding-color-preview", { detail: temporary })); }, [temporary]);
  const setFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => { const rect = event.currentTarget.getBoundingClientRect(); setHsv((current) => ({ ...current, s: clamp((event.clientX - rect.left) / rect.width), v: clamp(1 - (event.clientY - rect.top) / rect.height) })); };
  const hue = hsvToHex(hsv.h, 1, 1); const shade = (value: string) => { const channels = value.slice(1).match(/.{2}/g)?.map((part) => parseInt(part, 16) / 255) || [0, 0, 0]; const linear = channels.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4); return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722; }; const lowContrast = ((Math.max(shade(temporary), 1) + 0.05) / (Math.min(shade(temporary), 1) + 0.05)) < 3;
  const panel = <div ref={panelRef} className="mt-branding-picker" role="dialog" aria-label={`${label} picker`} style={{ position: "fixed", top: position.top, left: position.left }}><header><strong>{label}</strong><button type="button" aria-label="Close color picker" onClick={onCancel}><X size={15} /></button></header><div className="mt-branding-shade" style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hue})` }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setFromPointer(event); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromPointer(event); }} role="slider" tabIndex={0} aria-label={`${label} shade`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hsv.v * 100)} onKeyDown={(event) => { const step = event.shiftKey ? 0.1 : 0.02; if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return; event.preventDefault(); setHsv((current) => ({ ...current, s: clamp(current.s + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0)), v: clamp(current.v + (event.key === "ArrowDown" ? -step : event.key === "ArrowUp" ? step : 0)) })); }}><span style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} /></div><input className="mt-branding-hue" type="range" min="0" max="360" value={hsv.h} onChange={(event) => setHsv((current) => ({ ...current, h: Number(event.target.value) }))} aria-label={`${label} hue`} /><div className="mt-branding-picker__presets"><span>Recommended</span><div>{PRESETS.map((preset) => <button key={preset} type="button" aria-label="Use recommended color" style={{ background: preset }} onClick={() => setHsv(hexToHsv(preset))} />)}</div></div>{lowContrast && <p className="mt-branding-contrast" role="status">Low contrast<br /><span>This shade may be difficult to read.</span></p>}<div className="mt-branding-picker__compare"><span>Current <i style={{ background: value }} /></span><span>New <i style={{ background: temporary }} /></span></div><footer><button type="button" onClick={onCancel}>Cancel</button><button type="button" className="mt-button mt-button--primary" onClick={() => onApply(temporary)}>Apply</button></footer></div>;
  return typeof document === "undefined" ? null : createPortal(panel, document.body);
}
