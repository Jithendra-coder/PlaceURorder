"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import { useState } from "react";

type BusinessLogoProps = {
  src?: string | null;
  scale?: number | null;
  positionX?: number | null;
  positionY?: number | null;
  size?: number;
  className?: string;
  fallback?: string;
  alt?: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function BusinessLogo({
  src,
  scale = 120,
  positionX = 50,
  positionY = 50,
  size = 56,
  className = "",
  fallback,
  alt = "Business logo",
}: BusinessLogoProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const width = size;
  const zoom = clamp(Number(scale ?? 120), 60, 220) / 100;
  const objectPosition = `${clamp(Number(positionX ?? 50), 0, 100)}% ${clamp(Number(positionY ?? 50), 0, 100)}%`;
  const frameStyle: CSSProperties = {
    width,
    height: size,
    borderRadius: 12,
  };
  const imageStyle: CSSProperties = {
    objectPosition,
    transform: `scale(${zoom})`,
    transformOrigin: objectPosition,
  };
  const hasUsableImage = Boolean(src && failedSrc !== src);

  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden bg-[#050608] text-white shadow-sm ${className}`}
      style={frameStyle}
      aria-label={alt}
    >
      {hasUsableImage && src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={`${width}px`}
          unoptimized
          draggable={false}
          className="absolute inset-0 select-none object-contain"
          style={imageStyle}
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <span className="relative z-10 text-[0.42em] font-black uppercase tracking-tight">
          {fallback}
        </span>
      )}
    </span>
  );
}
