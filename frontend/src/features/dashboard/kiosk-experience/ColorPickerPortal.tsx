"use client";

import { useState, type ChangeEvent } from "react";
import { Button } from "@astryxdesign/core/Button";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { NoticeBanner } from "@/components/dashboard/kit";

export type ColorPickerProps = {
  label: string;
  value: string;
  onPreview: (value: string) => void;
  onCancel: () => void;
  onApply: (value: string) => void;
};

const PRESETS = ["#155EEF", "#079455", "#D92D20", "#7F56D9", "#E04F16", "#344054"];
const HEX = /^#[0-9a-f]{6}$/i;
const normalise = (value: string) => (HEX.test(value) ? value.toUpperCase() : "#155EEF");

// WCAG relative luminance of an sRGB hex color.
function luminance(hex: string) {
  const channels = hex.slice(1).match(/.{2}/g)?.map((part) => parseInt(part, 16) / 255) || [0, 0, 0];
  const linear = channels.map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

/** Color chooser shown in a popover: recommended presets, a hex field and a custom color input. */
export function ColorPickerPortal({ label, value, onPreview, onCancel, onApply }: ColorPickerProps) {
  const [temporary, setTemporary] = useState(normalise(value));
  const contrast = (Math.max(luminance(temporary), 1) + 0.05) / (Math.min(luminance(temporary), 1) + 0.05);
  const choose = (next: string) => {
    const color = normalise(next);
    setTemporary(color);
    onPreview(color);
  };
  const onNative = (event: ChangeEvent<HTMLInputElement>) => choose(event.target.value);

  return (
    <VStack gap={4} width={300}>
      <Text type="label">{label}</Text>
      <Grid columns={6} gap={2}>
        {PRESETS.map((preset) => (
          <ClickableCard key={preset} label={`Use ${preset}`} onClick={() => choose(preset)} padding={0}>
            <VStack gap={0} height={28} style={{ background: preset, borderRadius: "var(--radius-element)" }} />
          </ClickableCard>
        ))}
      </Grid>
      <HStack gap={2} vAlign="end">
        <TextInput label="Hex" value={temporary} onChange={(next) => choose(next.startsWith("#") ? next : `#${next}`)} status={HEX.test(temporary) ? undefined : { type: "error", message: "Use a 6-digit hex color" }} />
        <input type="color" aria-label={`${label} custom color`} value={normalise(temporary).toLowerCase()} onChange={onNative} style={{ width: 40, height: 40, padding: 0, border: 0, background: "none", cursor: "pointer" }} />
      </HStack>
      <HStack gap={3} vAlign="center">
        <VStack gap={1} align="center">
          <Text type="supporting" color="secondary">Current</Text>
          <VStack gap={0} width={48} height={28} style={{ background: value, borderRadius: "var(--radius-element)" }} />
        </VStack>
        <VStack gap={1} align="center">
          <Text type="supporting" color="secondary">New</Text>
          <VStack gap={0} width={48} height={28} style={{ background: temporary, borderRadius: "var(--radius-element)" }} />
        </VStack>
      </HStack>
      {contrast < 3 && <NoticeBanner tone="warning" title="Low contrast" description="This shade may be difficult to read on the kiosk." />}
      <HStack gap={2} hAlign="end">
        <Button label="Cancel" variant="secondary" onClick={onCancel} />
        <Button label="Apply color" variant="primary" onClick={() => onApply(temporary)} />
      </HStack>
    </VStack>
  );
}
