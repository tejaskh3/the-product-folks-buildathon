"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Draws its line art in once it scrolls into view.
 * Strokes marked data-d draw along their pathLength; elements marked data-f fade in.
 * An inline --delay (seconds) on either staggers it.
 */
export function DrawOnView({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setDrawn(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={`draw-on-view ${className}`} data-drawn={drawn ? "" : undefined}>
      {children}
    </div>
  );
}
