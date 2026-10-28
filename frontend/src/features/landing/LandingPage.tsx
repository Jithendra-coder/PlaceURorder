"use client";

import { useEffect, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { LANDING_HTML } from "./landing-content";
import { initLandingEngine } from "./landing-engine.js";

export default function LandingPage() {
  const router = useRouter();

  useEffect(() => {
    const cleanup = initLandingEngine();
    return () => {
      if (typeof cleanup === "function") cleanup();
    };
  }, []);

  function navigateInternalLink(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest<HTMLAnchorElement>("a[href]");
    if (!link || link.target && link.target !== "_self" || link.hasAttribute("download")) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const destination = new URL(link.href, window.location.href);
    if (destination.origin !== window.location.origin || destination.pathname === window.location.pathname) return;

    event.preventDefault();
    router.push(`${destination.pathname}${destination.search}${destination.hash}`);
  }

  return (
    <div
      id="landing-page-root"
      onClick={navigateInternalLink}
      dangerouslySetInnerHTML={{ __html: LANDING_HTML.replace("&copy; 2026", `&copy; ${new Date().getFullYear()}`) }}
      suppressHydrationWarning
    />
  );
}
