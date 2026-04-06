'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Total height of the wordmark in px. Default 26. */
  height?: number;
  /** Render light (white) version for dark backgrounds. Default false. */
  light?: boolean;
}

/**
 * Litro brand wordmark — Concept B (gauge).
 *
 * The "o" in "litro" is replaced by a price-gauge dial: a green→amber→red
 * arc with a needle pointing into the green zone.
 *
 * Uses getBBox() after fonts load to position the gauge flush against the
 * measured end of the "litr" text — same technique as the original concept HTML.
 * Falls back to a reasonable approximation on the initial SSR pass.
 */
export function LitroWordmark({ height = 26, light = false }: Props) {
  const fontSize   = Math.round(height * 2.0); // oversized; viewBox clips to height
  const baseline   = Math.round(fontSize * 0.85); // approximate baseline y in viewBox
  const svgHeight  = baseline + 4;               // small bottom padding

  // Fallback gauge position (approximate, used for SSR + before fonts load)
  // "litr" at given fontSize in Arial Black ≈ 91/52 × fontSize
  const approxTextW = Math.round((91 / 52) * fontSize);
  const xHeight     = Math.round(fontSize * 0.60);
  const r0          = xHeight / 2;
  const cx0         = 18 + approxTextW + r0 + 1;  // mirrors HTML spec formula
  const cy0         = baseline - xHeight / 2;

  const [cx, setCx] = useState(cx0);
  const [cy, setCy] = useState(cy0);
  const [r,  setR]  = useState(r0);
  const [ready, setReady] = useState(false);
  const textRef = useRef<SVGTextElement>(null);

  useEffect(() => {
    function measure() {
      const el = textRef.current;
      if (!el) return;
      try {
        const bbox   = el.getBBox();
        const xH     = fontSize * 0.60;
        const radius = xH / 2;
        const kern   = -1;
        setCx(bbox.x + bbox.width + kern + radius + 1);
        setCy(baseline - xH / 2);
        setR(radius);
        setReady(true);
      } catch {
        // getBBox() throws in some SSR/jsdom environments — ignore.
      }
    }

    if (document.fonts?.ready) {
      void document.fonts.ready.then(measure);
    } else {
      measure();
    }
  }, [fontSize, baseline]);

  const trackW    = r * 0.28;
  const toRad     = (d: number) => (d * Math.PI) / 180;
  const ax1       = cx + r * Math.cos(toRad(150));
  const ay1       = cy + r * Math.sin(toRad(150));
  const ax2       = cx + r * Math.cos(toRad(30));
  const ay2       = cy + r * Math.sin(toRad(30));
  const arcD      = `M ${ax1.toFixed(2)} ${ay1.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 1 1 ${ax2.toFixed(2)} ${ay2.toFixed(2)}`;
  const needleLen = r * 0.72;
  const nx        = (cx + needleLen * Math.cos(toRad(210))).toFixed(2);
  const ny        = (cy + needleLen * Math.sin(toRad(210))).toFixed(2);
  const pivotR    = (trackW * 0.75).toFixed(2);

  const viewW     = Math.ceil(cx + r + 6);

  const ink        = light ? '#ffffff' : '#1a1a1a';
  const gaugeBg    = light ? '#222222' : '#f4f4f4';
  const gaugeStroke = light ? '#2a2a2a' : '#e0e0e0';
  const gradId     = light ? 'litroGradDark' : 'litroGradLight';

  return (
    <svg
      viewBox={`0 0 ${viewW} ${svgHeight}`}
      height={height}
      width={(viewW / svgHeight) * height}
      aria-label="Litro"
      role="img"
      style={{ display: 'block', opacity: ready ? 1 : 0.85 }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#22c55e" />
          <stop offset="48%"  stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
      </defs>

      {/* "litr" wordmark text */}
      <text
        ref={textRef}
        x={18}
        y={baseline}
        fontFamily='"Arial Black", Arial, sans-serif'
        fontWeight={900}
        fontSize={fontSize}
        fill={ink}
        letterSpacing={-1}
      >
        litr
      </text>

      {/* Gauge "o" */}
      <circle cx={cx} cy={cy} r={r} fill={gaugeBg} stroke={gaugeStroke} strokeWidth={1} />

      {/* Track arc */}
      <path d={arcD} fill="none" stroke={gaugeStroke} strokeWidth={trackW} strokeLinecap="round" />

      {/* Coloured arc */}
      <path d={arcD} fill="none" stroke={`url(#${gradId})`} strokeWidth={trackW} strokeLinecap="round" />

      {/* Needle */}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={ink} strokeWidth={trackW * 0.55} strokeLinecap="round" />

      {/* Pivot */}
      <circle cx={cx} cy={cy} r={pivotR} fill={ink} />
    </svg>
  );
}
