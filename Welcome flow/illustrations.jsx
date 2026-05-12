// illustrations.jsx — 5 geometric line illustrations for the litro welcome carousel
// Style discipline:
//   • Line weight: 1.5px primary (1px secondary for fine detail)
//   • Ink: #1a1a1a; soft ink: #6b7280; hairline: rgba(26,26,26,.18)
//   • Accent: amber #f59e0b (used sparingly — fill or accent stroke only)
//   • Price-spectrum colours used ONLY on Card 3 pins (the legend itself)
//   • Each illustration draws into a 280×180 viewBox, scales to width

const TOKENS = {
  ink:      '#1a1a1a',
  ink70:    '#2a2a2a',
  soft:     '#6b7280',
  hair:     'rgba(26,26,26,0.16)',
  amber:    '#f59e0b',
  amberSoft:'rgba(245,158,11,0.14)',
  cream:    '#fdf6ee',
  green:    '#1a9641',
  greenSoft:'#66bd63',
  gold:     '#f5c542',
  red:      '#d7191c',
  slate:    '#94a3b8',
};

const STROKE = { stroke: TOKENS.ink, strokeWidth: 1.5, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
const STROKE_FINE = { stroke: TOKENS.soft, strokeWidth: 1, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
const STROKE_AMBER = { stroke: TOKENS.amber, strokeWidth: 1.5, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };

// ─────────────────────────────────────────────────────────────
// 1 — Welcome / Identity: abstract street grid + scattered pins + litro wordmark plate
// ─────────────────────────────────────────────────────────────
function Illustration1({ width = 280 }) {
  return (
    <svg width={width} viewBox="0 0 280 180" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      {/* Soft warm card backdrop with rounded clip */}
      <defs>
        <clipPath id="il1-clip">
          <rect x="20" y="14" width="240" height="152" rx="14" />
        </clipPath>
      </defs>
      <rect x="20" y="14" width="240" height="152" rx="14" fill={TOKENS.cream} stroke={TOKENS.hair} />
      <g clipPath="url(#il1-clip)">
        {/* horizontal "streets" */}
        {[36, 60, 88, 120, 148].map((y, i) => (
          <line key={'h'+i} x1="20" y1={y} x2="260" y2={y} stroke={TOKENS.hair} strokeWidth="1" />
        ))}
        {/* verticals — slightly skewed to feel map-like */}
        {[44, 78, 116, 156, 196, 232].map((x, i) => (
          <line key={'v'+i} x1={x} y1="14" x2={x - 6} y2="166" stroke={TOKENS.hair} strokeWidth="1" />
        ))}
        {/* diagonal "highway" */}
        <path d="M22 154 C 80 130, 180 96, 260 60" stroke={TOKENS.hair} strokeWidth="1.25" fill="none" />
      </g>

      {/* Pin glyphs (small, scattered) */}
      <Pin x={62}  y={48}  fill={TOKENS.greenSoft} />
      <Pin x={206} y={42}  fill={TOKENS.red} />
      <Pin x={232} y={120} fill={TOKENS.gold} />
      <Pin x={48}  y={130} fill={TOKENS.green} />

      {/* Wordmark plate (visual centerpiece) */}
      <g>
        <rect x="86" y="74" width="108" height="36" rx="10" fill="#fff" stroke={TOKENS.ink} strokeWidth="1.5" />
        <text x="140" y="98" textAnchor="middle"
              fontFamily="-apple-system, system-ui, sans-serif"
              fontSize="20" fontWeight="700" fill={TOKENS.ink} letterSpacing="-0.3">litro</text>
        {/* tiny amber dot on the i-tittle to anchor brand colour */}
        <circle cx="135.5" cy="80.5" r="2.2" fill={TOKENS.amber} />
      </g>
    </svg>
  );
}

// Reusable pin glyph (teardrop, point-down, optional tilde for estimate)
// Geometry: sharp tip at (0,0); circular crown of r=10 centred at (0,-14).
// Sides leave the tip with near-vertical tangents so the point reads crisp.
function Pin({ x, y, fill = TOKENS.amber, estimate = false, scale = 1 }) {
  const d = 'M 0 0 C 0 -4, -10 -7, -10 -14 A 10 10 0 1 1 10 -14 C 10 -7, 0 -4, 0 0 Z';
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d={d}
            fill={estimate ? '#fff' : fill}
            stroke={estimate ? TOKENS.slate : TOKENS.ink}
            strokeWidth={estimate ? 1.5 : 1.25}
            strokeLinejoin="round" />
      {estimate
        ? <text x="0" y="-11" textAnchor="middle" fontFamily="-apple-system, system-ui" fontSize="11" fontWeight="700" fill={TOKENS.slate}>~</text>
        : <circle cx="0" cy="-15" r="2.6" fill="#fff" />}
    </g>
  );
}

// ─────────────────────────────────────────────────────────────
// 2 — Where the data comes from: phone → camera viewfinder on price board → cloud → ✓
// ─────────────────────────────────────────────────────────────
function Illustration2({ width = 280 }) {
  return (
    <svg width={width} viewBox="0 0 280 180" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      {/* Phone outline (left) */}
      <g transform="translate(36 24)">
        <rect x="0" y="0" width="92" height="132" rx="14" fill="#fff" stroke={TOKENS.ink} strokeWidth="1.5" />
        {/* speaker slit */}
        <rect x="36" y="8" width="20" height="3" rx="1.5" fill={TOKENS.ink} />
        {/* viewfinder framing inside the phone */}
        <g stroke={TOKENS.ink} strokeWidth="1.5" fill="none" strokeLinecap="round">
          <path d="M14 32 L14 24 L22 24" />
          <path d="M70 24 L78 24 L78 32" />
          <path d="M78 92 L78 100 L70 100" />
          <path d="M22 100 L14 100 L14 92" />
        </g>
        {/* The price board being captured (inside the viewfinder) */}
        <g transform="translate(22 38)">
          <rect x="0" y="0" width="48" height="48" rx="3" fill={TOKENS.cream} stroke={TOKENS.ink} strokeWidth="1.25" />
          {/* three "price rows" */}
          <line x1="6" y1="11" x2="20" y2="11" stroke={TOKENS.ink} strokeWidth="1.25" strokeLinecap="round" />
          <line x1="24" y1="11" x2="42" y2="11" stroke={TOKENS.amber} strokeWidth="2" strokeLinecap="round" />
          <line x1="6" y1="24" x2="20" y2="24" stroke={TOKENS.ink} strokeWidth="1.25" strokeLinecap="round" />
          <line x1="24" y1="24" x2="42" y2="24" stroke={TOKENS.ink} strokeWidth="1.25" strokeLinecap="round" />
          <line x1="6" y1="37" x2="20" y2="37" stroke={TOKENS.ink} strokeWidth="1.25" strokeLinecap="round" />
          <line x1="24" y1="37" x2="42" y2="37" stroke={TOKENS.ink} strokeWidth="1.25" strokeLinecap="round" />
        </g>
        {/* Shutter button hint */}
        <circle cx="46" cy="116" r="6" fill="none" stroke={TOKENS.ink} strokeWidth="1.5" />
        <circle cx="46" cy="116" r="3" fill={TOKENS.amber} />
      </g>

      {/* Arrow → */}
      <g transform="translate(140 80)">
        <path d="M0 10 H 38" {...STROKE} />
        <path d="M30 4 L 38 10 L 30 16" {...STROKE} />
      </g>

      {/* Cloud + check (right) */}
      <g transform="translate(186 56)">
        <path d="M14 36 C 4 36, 0 28, 6 22 C 4 12, 16 6, 22 12 C 28 4, 44 6, 44 18 C 54 18, 56 30, 48 36 Z"
              fill="#fff" stroke={TOKENS.ink} strokeWidth="1.5" strokeLinejoin="round" />
        {/* Check inside */}
        <path d="M18 26 L 25 33 L 38 20" stroke={TOKENS.amber} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      {/* Tiny dotted upload trail (camera → cloud) */}
      <g fill={TOKENS.soft}>
        <circle cx="146" cy="60" r="1.2" />
        <circle cx="158" cy="52" r="1.2" />
        <circle cx="172" cy="48" r="1.2" />
        <circle cx="186" cy="48" r="1.2" />
      </g>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// 3 — Pin colours: 3 verified pins + 1 estimate pin, with labels
// ─────────────────────────────────────────────────────────────
function Illustration3({ width = 280 }) {
  const labels = ['Tanio', 'Średnio', 'Drogo', 'Szacunek'];
  const cols = [TOKENS.green, TOKENS.gold, TOKENS.red, null]; // null = estimate
  const xs = [54, 116, 178, 240];
  return (
    <svg width={width} viewBox="0 0 280 180" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      {/* faint baseline */}
      <line x1="34" y1="116" x2="246" y2="116" stroke={TOKENS.hair} strokeWidth="1" strokeDasharray="2 4" />
      {xs.map((x, i) => (
        <g key={i}>
          <Pin x={x} y={116} fill={cols[i] || '#fff'} estimate={cols[i] == null} scale={1.55} />
          <text x={x} y="148" textAnchor="middle"
                fontFamily="-apple-system, system-ui" fontSize="11"
                fontWeight={i === 3 ? 500 : 600}
                fill={i === 3 ? TOKENS.soft : TOKENS.ink70}>{labels[i]}</text>
        </g>
      ))}
      {/* tiny tick legend hint above (price spectrum bar) */}
      <g transform="translate(54 38)">
        <rect x="0" y="0" width="44" height="6" rx="3" fill={TOKENS.green} />
        <rect x="62" y="0" width="44" height="6" rx="3" fill={TOKENS.gold} />
        <rect x="124" y="0" width="44" height="6" rx="3" fill={TOKENS.red} />
      </g>
      <text x="140" y="60" textAnchor="middle"
            fontFamily="-apple-system, system-ui" fontSize="10" fontWeight="500" fill={TOKENS.soft}
            letterSpacing="0.4">CENA WZGLĘDEM ŚREDNIEJ</text>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// 4 — How to use litro: fork composition.
//     PRIMARY (left, larger): phone-with-map → consume.
//     SECONDARY (right, smaller, with "albo" label): camera + cloud → optional contribute.
// ─────────────────────────────────────────────────────────────
function Illustration4({ width = 280 }) {
  return (
    <svg width={width} viewBox="0 0 280 180" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      {/* ─── PRIMARY PATH (left) ─── consume: phone showing the map ─── */}
      <g transform="translate(28 22)">
        {/* phone shell — larger */}
        <rect x="0" y="0" width="116" height="140" rx="16" fill="#fff" stroke={TOKENS.ink} strokeWidth="1.5" />
        {/* speaker slit */}
        <rect x="48" y="9" width="20" height="3" rx="1.5" fill={TOKENS.ink} />
        {/* map screen inset */}
        <g>
          <rect x="10" y="22" width="96" height="104" rx="8" fill={TOKENS.cream} stroke={TOKENS.hair} />
          {/* map grid */}
          <g stroke={TOKENS.hair} strokeWidth="0.8">
            <line x1="10" y1="46" x2="106" y2="46" />
            <line x1="10" y1="74" x2="106" y2="74" />
            <line x1="10" y1="100" x2="106" y2="100" />
            <line x1="40" y1="22" x2="36" y2="126" />
            <line x1="76" y1="22" x2="80" y2="126" />
          </g>
          {/* a faint highway curve */}
          <path d="M14 116 C 36 96, 80 70, 104 38" stroke={TOKENS.hair} strokeWidth="1" fill="none" />
          {/* three pins on the map */}
          <Pin x={32} y={64}  fill={TOKENS.green} scale={0.95} />
          <Pin x={62} y={92}  fill={TOKENS.gold}  scale={0.95} />
          <Pin x={88} y={56}  fill={TOKENS.red}   scale={0.95} />
        </g>
      </g>

      {/* ─── DIVIDER + "albo" label ─── */}
      <g>
        <line x1="160" y1="34" x2="160" y2="148" stroke={TOKENS.hair} strokeWidth="1" strokeDasharray="2 4" />
        <g transform="translate(160 90)">
          <rect x="-19" y="-12" width="38" height="22" rx="11" fill="#fff" stroke={TOKENS.hair} strokeWidth="1" />
          <text x="0" y="3" textAnchor="middle"
                fontFamily="-apple-system, system-ui" fontSize="11" fontWeight="600"
                fill={TOKENS.soft} letterSpacing="0.4">albo</text>
        </g>
      </g>

      {/* ─── SECONDARY PATH (right) ─── contribute: camera + cloud ─── */}
      <g transform="translate(180 38)" opacity="0.95">
        {/* phone shell — smaller, secondary */}
        <rect x="0" y="0" width="60" height="92" rx="10" fill="#fff" stroke={TOKENS.ink} strokeWidth="1.25" />
        {/* viewfinder corners */}
        <g stroke={TOKENS.ink} strokeWidth="1.25" fill="none" strokeLinecap="round">
          <path d="M8 22 L 8 16 L 14 16" />
          <path d="M46 16 L 52 16 L 52 22" />
          <path d="M52 64 L 52 70 L 46 70" />
          <path d="M14 70 L 8 70 L 8 64" />
        </g>
        {/* mini price-board inside viewfinder */}
        <g transform="translate(14 24)">
          <rect x="0" y="0" width="32" height="38" rx="2" fill={TOKENS.cream} stroke={TOKENS.ink} strokeWidth="1" />
          <line x1="4" y1="9"  x2="14" y2="9"  stroke={TOKENS.ink} strokeWidth="1" strokeLinecap="round" />
          <line x1="18" y1="9"  x2="28" y2="9"  stroke={TOKENS.amber} strokeWidth="1.6" strokeLinecap="round" />
          <line x1="4" y1="20" x2="14" y2="20" stroke={TOKENS.ink} strokeWidth="1" strokeLinecap="round" />
          <line x1="18" y1="20" x2="28" y2="20" stroke={TOKENS.ink} strokeWidth="1" strokeLinecap="round" />
          <line x1="4" y1="31" x2="14" y2="31" stroke={TOKENS.ink} strokeWidth="1" strokeLinecap="round" />
          <line x1="18" y1="31" x2="28" y2="31" stroke={TOKENS.ink} strokeWidth="1" strokeLinecap="round" />
        </g>
        {/* shutter dot */}
        <circle cx="30" cy="80" r="4" fill="none" stroke={TOKENS.ink} strokeWidth="1.25" />
        <circle cx="30" cy="80" r="2" fill={TOKENS.amber} />

        {/* tiny cloud + check above the phone — system-side outcome */}
        <g transform="translate(8 -28)">
          <path d="M10 24 C 2 24, -1 17, 4 12 C 2 4, 12 0, 17 5 C 22 -1, 35 1, 35 11 C 43 11, 45 21, 38 24 Z"
                fill="#fff" stroke={TOKENS.ink} strokeWidth="1.25" strokeLinejoin="round" />
          <path d="M13 14 L 19 19 L 28 9" stroke={TOKENS.amber} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        {/* dotted upload trail */}
        <g fill={TOKENS.soft}>
          <circle cx="30" cy="-2" r="1" />
          <circle cx="30" cy="-8" r="1" />
        </g>
      </g>
    </svg>
  );
}

// Card-4 ALTERNATE — vertical stack of the same fork, primary on top, secondary below.
function Illustration4Alt({ width = 280 }) {
  return (
    <svg width={width} viewBox="0 0 280 180" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      {/* PRIMARY (top) — phone with map, horizontal orientation */}
      <g transform="translate(38 14)">
        <rect x="0" y="0" width="160" height="74" rx="10" fill="#fff" stroke={TOKENS.ink} strokeWidth="1.5" />
        {/* map screen */}
        <rect x="8" y="8" width="144" height="58" rx="6" fill={TOKENS.cream} stroke={TOKENS.hair} />
        <g stroke={TOKENS.hair} strokeWidth="0.8">
          <line x1="8" y1="28" x2="152" y2="28" />
          <line x1="8" y1="46" x2="152" y2="46" />
          <line x1="48" y1="8" x2="44" y2="66" />
          <line x1="92" y1="8" x2="96" y2="66" />
          <line x1="128" y1="8" x2="124" y2="66" />
        </g>
        <Pin x={36}  y={42} fill={TOKENS.green} scale={0.85} />
        <Pin x={84}  y={56} fill={TOKENS.gold}  scale={0.85} />
        <Pin x={128} y={36} fill={TOKENS.red}   scale={0.85} />
      </g>

      {/* "albo" connector */}
      <g transform="translate(140 96)">
        <line x1="0" y1="-6" x2="0" y2="-2" stroke={TOKENS.hair} strokeWidth="1" />
        <line x1="0" y1="14" x2="0" y2="18" stroke={TOKENS.hair} strokeWidth="1" />
        <rect x="-19" y="-2" width="38" height="20" rx="10" fill="#fff" stroke={TOKENS.hair} strokeWidth="1" />
        <text x="0" y="11" textAnchor="middle"
              fontFamily="-apple-system, system-ui" fontSize="11" fontWeight="600"
              fill={TOKENS.soft} letterSpacing="0.4">albo</text>
      </g>

      {/* SECONDARY (bottom) — small camera + cloud */}
      <g transform="translate(86 122)">
        {/* phone */}
        <rect x="0" y="0" width="44" height="46" rx="6" fill="#fff" stroke={TOKENS.ink} strokeWidth="1.25" />
        <g stroke={TOKENS.ink} strokeWidth="1" fill="none" strokeLinecap="round">
          <path d="M6 14 L 6 10 L 10 10" />
          <path d="M34 10 L 38 10 L 38 14" />
          <path d="M38 32 L 38 36 L 34 36" />
          <path d="M10 36 L 6 36 L 6 32" />
        </g>
        <rect x="14" y="14" width="16" height="18" rx="1.5" fill={TOKENS.cream} stroke={TOKENS.ink} strokeWidth="1" />
        {/* arrow → cloud */}
        <path d="M52 22 H 70" stroke={TOKENS.ink} strokeWidth="1.25" fill="none" strokeLinecap="round" />
        <path d="M64 17 L 70 22 L 64 27" stroke={TOKENS.ink} strokeWidth="1.25" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <g transform="translate(76 8)">
          <path d="M10 24 C 2 24, -1 17, 4 12 C 2 4, 12 0, 17 5 C 22 -1, 35 1, 35 11 C 43 11, 45 21, 38 24 Z"
                fill={TOKENS.cream} stroke={TOKENS.ink} strokeWidth="1.25" strokeLinejoin="round" />
          <path d="M13 14 L 19 19 L 28 9" stroke={TOKENS.amber} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// 5 — Reward: bell + "+30 dni" badge + small calendar
// ─────────────────────────────────────────────────────────────
function Illustration5({ width = 280 }) {
  // Community-network nodes (faint, behind the bell). Pin colours from the
  // price spectrum but rendered small + low-contrast so they read as "community
  // dots", not legend items. The bell remains the focal element.
  const nodes = [
    { x: 36,  y: 42,  c: TOKENS.greenSoft },
    { x: 244, y: 50,  c: TOKENS.gold },
    { x: 28,  y: 134, c: TOKENS.gold },
    { x: 252, y: 130, c: TOKENS.green },
    { x: 80,  y: 22,  c: TOKENS.red },
    { x: 200, y: 22,  c: TOKENS.green },
  ];
  // Anchor for connecting lines — the bell's centre.
  const cx = 140, cy = 78;
  return (
    <svg width={width} viewBox="0 0 280 180" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      {/* Soft amber tonal field — communal warmth, sits behind everything */}
      <ellipse cx="140" cy="86" rx="120" ry="62" fill={TOKENS.amberSoft} />

      {/* Connecting lines — driver-to-driver / driver-to-map graph */}
      <g stroke={TOKENS.hair} strokeWidth="1" strokeDasharray="2 4" fill="none">
        {nodes.map((n, i) => (
          <line key={i} x1={n.x} y1={n.y} x2={cx} y2={cy} />
        ))}
      </g>

      {/* Faint community pins */}
      {nodes.map((n, i) => (
        <g key={i} opacity="0.55">
          <Pin x={n.x} y={n.y} fill={n.c} scale={0.7} />
        </g>
      ))}

      {/* Subtle radiant arcs (alert "ringing" suggestion, very restrained) */}
      <g fill="none" stroke={TOKENS.amber} strokeWidth="1.25" strokeLinecap="round" opacity="0.55">
        <path d="M104 64 Q 98 78, 104 92" />
        <path d="M92 54 Q 82 78, 92 102" />
      </g>
      <g fill="none" stroke={TOKENS.amber} strokeWidth="1.25" strokeLinecap="round" opacity="0.55">
        <path d="M176 64 Q 182 78, 176 92" />
        <path d="M188 54 Q 198 78, 188 102" />
      </g>

      {/* Bell */}
      <g transform="translate(120 36)">
        <path d="M20 8 C 8 8, 4 18, 4 32 C 4 44, 0 50, 0 56 L 40 56 C 40 50, 36 44, 36 32 C 36 18, 32 8, 20 8 Z"
              fill="#fff" stroke={TOKENS.ink} strokeWidth="1.5" strokeLinejoin="round" />
        {/* clapper */}
        <path d="M16 56 C 16 62, 24 62, 24 56" stroke={TOKENS.ink} strokeWidth="1.5" fill="none" strokeLinecap="round" />
        {/* top knob */}
        <circle cx="20" cy="6" r="2.5" fill={TOKENS.ink} />
      </g>

      {/* "+30 dni" badge — amber pill, anchored top-right of bell */}
      <g transform="translate(166 38)">
        <rect x="0" y="0" width="62" height="26" rx="13" fill={TOKENS.amber} />
        <text x="31" y="17.5" textAnchor="middle"
              fontFamily="-apple-system, system-ui" fontSize="13" fontWeight="700" fill="#fff">
          +30 dni
        </text>
      </g>

      {/* Mini calendar (renewal hint) */}
      <g transform="translate(118 116)">
        <rect x="0" y="0" width="44" height="34" rx="4" fill="#fff" stroke={TOKENS.ink} strokeWidth="1.5" />
        <line x1="0" y1="9" x2="44" y2="9" stroke={TOKENS.ink} strokeWidth="1.5" />
        <line x1="11" y1="-3" x2="11" y2="5" stroke={TOKENS.ink} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="33" y1="-3" x2="33" y2="5" stroke={TOKENS.ink} strokeWidth="1.5" strokeLinecap="round" />
        {/* dots in cells */}
        {[0,1,2].map(r =>
          [0,1,2,3].map(c => {
            const cx = 7 + c * 10;
            const cy = 17 + r * 6;
            const isHi = r === 1 && c === 2;
            return <circle key={`${r}-${c}`} cx={cx} cy={cy} r="1.6"
                           fill={isHi ? TOKENS.amber : TOKENS.hair} />;
          })
        )}
      </g>
    </svg>
  );
}

window.LitroIllustrations = {
  Illustration1, Illustration2, Illustration3, Illustration4, Illustration4Alt, Illustration5,
  Pin, TOKENS,
};
