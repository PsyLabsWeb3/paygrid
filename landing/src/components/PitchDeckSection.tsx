import React, { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion, motion } from "framer-motion";
import { slides } from "./pitchDeckData";
import PitchSlide from "./PitchSlide";
import DeckNavigation from "./DeckNavigation";
import SlideProgress from "./SlideProgress";

export default function PitchDeckSection() {
  const [index, setIndex] = useState(0);
  const reduced = useReducedMotion();
  const total = slides.length;

  // When the pitch deck mounts, make it fullscreen-like and prevent body scroll
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // add a class to root for extra styling if needed
    document.documentElement.classList.add("pitchdeck-open");
    return () => {
      document.body.style.overflow = prevOverflow;
      document.documentElement.classList.remove("pitchdeck-open");
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setIndex((i) => Math.min(total - 1, i + 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      if (e.key === "Home") setIndex(0);
      if (e.key === "End") setIndex(total - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total]);

  // swipe support
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startX = 0;
    let startY = 0;
    const onStart = (ev: TouchEvent) => {
      startX = ev.touches[0].clientX;
      startY = ev.touches[0].clientY;
    };
    const onEnd = (ev: TouchEvent) => {
      const dx = ev.changedTouches[0].clientX - startX;
      const dy = ev.changedTouches[0].clientY - startY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
        if (dx < 0) setIndex((i) => Math.min(total - 1, i + 1));
        else setIndex((i) => Math.max(0, i - 1));
      }
    };
    el.addEventListener("touchstart", onStart);
    el.addEventListener("touchend", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend", onEnd);
    };
  }, [total]);

  useEffect(() => {
    // update hash for shareable anchor
    window.history.replaceState(null, "", `#pitch-${slides[index].id}`);
  }, [index]);

  // check hash on mount
  useEffect(() => {
    const h = window.location.hash.replace("#pitch-", "");
    const id = Number(h);
    if (id && id >= 1 && id <= total) setIndex(id - 1);
  }, [total]);

  return (
    <section className="pitchdeck" id="pitchdeck">
      <div className="pitch-shell" ref={ref}>
        <div className="pitch-canvas" aria-hidden>
          {/* Three.js scene removed to avoid blocking pointer events on controls.
              Provide a lightweight static SVG/network fallback that is fully
              non-interactive and accessible. */}
          <div
            className="pitch-canvas-fallback"
            style={{ padding: 18, pointerEvents: "none" }}
          >
            <svg
              width="100%"
              height="100%"
              viewBox="0 0 600 240"
              preserveAspectRatio="xMidYMid meet"
              role="img"
            >
              <g fill="none" stroke="#b7ff1a" strokeWidth="1.6">
                <circle cx="50" cy="120" r="8" fill="#b7ff1a" />
                <circle cx="170" cy="60" r="6" fill="#b7ff1a" />
                <circle cx="290" cy="120" r="6" fill="#b7ff1a" />
                <circle cx="410" cy="60" r="6" fill="#b7ff1a" />
                <circle cx="530" cy="120" r="8" fill="#b7ff1a" />
                <path d="M58 120 L162 64" />
                <path d="M178 64 L282 120" />
                <path d="M298 120 L402 64" />
                <path d="M418 64 L522 120" />
              </g>
            </svg>
          </div>
        </div>
        <div className="pitch-content">
          <SlideProgress index={index} total={total} />
          <motion.div
            key={slides[index].id}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: reduced ? 0 : 0.42 }}
          >
            <PitchSlide slide={slides[index]} />
          </motion.div>
          <DeckNavigation index={index} setIndex={setIndex} total={total} />
        </div>
      </div>
    </section>
  );
}
