// carousel.jsx — litro welcome carousel card + 5-step interactive carousel
// Renders inside a fixed-size mobile viewport (designed for ~390×780 inner area).

const { Illustration1, Illustration2, Illustration3, Illustration4, Illustration5, TOKENS } = window.LitroIllustrations;

// ─────────── Card content data (PL canonical, exact copy from brief) ───────────
const CARDS = [
  {
    id: 1,
    Illo: Illustration1,
    title: 'Witaj w litro',
    body: 'Mapa cen paliw tworzona przez kierowców — dla kierowców. Pokażemy Ci, jak to działa.',
    hint: 'Zajmie to chwilę.',
    cta: 'Dalej',
  },
  {
    id: 2,
    Illo: Illustration2,
    title: 'Skąd biorą się ceny?',
    body: 'Każda cena pochodzi od kierowcy, który zrobił zdjęcie tablicy ze stacji. Sprawdzamy każde zgłoszenie automatycznie.',
    cta: 'Dalej',
  },
  {
    id: 3,
    Illo: Illustration3,
    title: 'Kolory pinezek',
    body: (
      <>
        <strong style={{ color: TOKENS.green, fontWeight: 600 }}>Zielone</strong> = tańsze niż średnia.{' '}
        <strong style={{ color: TOKENS.red, fontWeight: 600 }}>Czerwone</strong> = droższe.
        Znak <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.95em', color: TOKENS.soft }}>~</code> przy cenie oznacza, że jest ona szacunkowa — dopóki nikt nie zgłosi tej stacji.
      </>
    ),
    cta: 'Dalej',
  },
  {
    id: 4,
    Illo: Illustration4,
    title: 'Jak korzystać z litro',
    // Custom two-line body: primary (consume) reads dominant; secondary (contribute) is an invitation.
    body: (
      <>
        <span style={{
          display: 'block',
          fontSize: 17, fontWeight: 600, lineHeight: '24px',
          color: TOKENS.ink, opacity: 1,
        }}>
          Otwórz, sprawdź ceny, oszczędzaj. Tyle wystarczy.
        </span>
        <span style={{
          display: 'block', marginTop: 12,
          fontSize: 15, fontWeight: 400, lineHeight: '22px',
          color: TOKENS.ink70, opacity: 0.78,
        }}>
          Chcesz dodać coś od siebie? Zrób zdjęcie cen na stacji, którą mijasz.
          Resztą zajmiemy się my — odczytamy je i dodamy do mapy.
        </span>
      </>
    ),
    cta: 'Dalej',
  },
  {
    id: 5,
    Illo: Illustration5,
    title: 'Witamy w społeczności litro',
    body: 'Mapa działa dla wszystkich kierowców, dzięki tym, którzy dzielą się cenami. Twoje zdjęcia odblokowują alerty premium na 30 dni — uprzedzimy Cię, gdy ceny mają wzrosnąć.',
    cta: 'Zaczynamy',
    ctaIsFinal: true,
  },
];

// ─────────── Progress dots ───────────
function Dots({ count, active }) {
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center', height: 8 }}>
      {Array.from({ length: count }).map((_, i) => {
        const isActive = i === active;
        return (
          <div key={i} style={{
            width: isActive ? 22 : 8,
            height: 8,
            borderRadius: 999,
            background: isActive ? TOKENS.amber : '#e5e7eb',
            transition: 'width 280ms cubic-bezier(.2,.7,.3,1), background 200ms',
          }} />
        );
      })}
    </div>
  );
}

// ─────────── Buttons ───────────
function PrimaryBtn({ children, onClick }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, height: 52, borderRadius: 999, border: 'none',
      background: TOKENS.amber, color: '#fff',
      fontFamily: '-apple-system, system-ui, sans-serif',
      fontSize: 17, fontWeight: 600, letterSpacing: -0.2,
      cursor: 'pointer', boxShadow: '0 1px 0 rgba(0,0,0,0.04), 0 8px 18px rgba(245,158,11,0.28)',
      transition: 'transform 80ms ease, box-shadow 200ms',
    }}
    onMouseDown={e => e.currentTarget.style.transform = 'scale(0.985)'}
    onMouseUp={e => e.currentTarget.style.transform = ''}
    onMouseLeave={e => e.currentTarget.style.transform = ''}
    >{children}</button>
  );
}

function SecondaryBtn({ children, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: 88, height: 52, borderRadius: 999,
      border: '1.5px solid ' + TOKENS.hair, background: '#fff',
      color: TOKENS.ink70,
      fontFamily: '-apple-system, system-ui, sans-serif',
      fontSize: 17, fontWeight: 500, letterSpacing: -0.2,
      cursor: 'pointer', transition: 'background 120ms, border-color 120ms',
    }}
    onMouseDown={e => e.currentTarget.style.background = '#f4f4f4'}
    onMouseUp={e => e.currentTarget.style.background = '#fff'}
    onMouseLeave={e => e.currentTarget.style.background = '#fff'}
    >{children}</button>
  );
}

// ─────────── A single welcome card (full-screen mobile content) ───────────
function WelcomeCard({ card, index, total, onNext, onBack, onFinish }) {
  const { Illo, title, body, hint, cta, ctaIsFinal } = card;
  const isFirst = index === 0;
  return (
    <div
      data-screen-label={`Card ${index + 1} · ${title}`}
      style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        background: '#fff',
        padding: '0 24px',
        fontFamily: '-apple-system, system-ui, sans-serif',
        color: TOKENS.ink,
      }}>
      {/* Top: progress dots (sit just under the iOS status bar / dynamic island area) */}
      <div style={{ paddingTop: 70, paddingBottom: 28 }}>
        <Dots count={total} active={index} />
      </div>

      {/* Illustration zone — centred, ~180 tall */}
      <div style={{
        height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 28,
      }}>
        <Illo width={290} />
      </div>

      {/* Text block */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <h1 style={{
          margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: -0.5,
          color: TOKENS.ink, lineHeight: '30px', textWrap: 'balance',
          maxWidth: 320,
        }}>{title}</h1>

        <div style={{
          margin: '14px 0 0',
          fontSize: 16, fontWeight: 400, lineHeight: '24px',
          color: TOKENS.ink70, opacity: 0.86,
          maxWidth: 320, textWrap: 'pretty',
        }}>{body}</div>

        {hint && (
          <p style={{
            margin: '14px 0 0',
            fontSize: 13, fontWeight: 500, color: TOKENS.soft,
            maxWidth: 320,
          }}>{hint}</p>
        )}
      </div>

      {/* Buttons */}
      <div style={{
        display: 'flex', gap: 10,
        paddingBottom: 38, paddingTop: 16,
      }}>
        {!isFirst && <SecondaryBtn onClick={onBack}>Wstecz</SecondaryBtn>}
        <PrimaryBtn onClick={ctaIsFinal ? onFinish : onNext}>{cta}</PrimaryBtn>
      </div>
    </div>
  );
}

// ─────────── Interactive carousel (forward-only, with optional free-paginate) ───────────
function WelcomeCarousel({ free = false, onFinish }) {
  const [idx, setIdx] = React.useState(0);
  const [finished, setFinished] = React.useState(false);
  const total = CARDS.length;

  const next = () => setIdx(i => Math.min(i + 1, total - 1));
  const back = () => setIdx(i => Math.max(i - 1, 0));
  const finish = () => {
    if (onFinish) onFinish();
    else setFinished(true);
  };

  // Reset when re-entered
  const reset = () => { setIdx(0); setFinished(false); };

  if (finished) {
    return <FauxMapAfter onReset={reset} />;
  }

  return (
    <WelcomeCard
      card={CARDS[idx]}
      index={idx}
      total={total}
      onNext={next}
      onBack={free || idx > 0 ? back : null}
      onFinish={finish}
    />
  );
}

// A faint "you've entered the app" placeholder shown after Zaczynamy.
// (Not a designed map — just a confirmation surface so the demo loop is closed.)
function FauxMapAfter({ onReset }) {
  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      background: TOKENS.cream,
      fontFamily: '-apple-system, system-ui, sans-serif',
    }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <div style={{
          width: 56, height: 56, borderRadius: 999, background: TOKENS.amber,
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20,
          boxShadow: '0 8px 24px rgba(245,158,11,0.32)',
        }}>
          <svg width="28" height="28" viewBox="0 0 28 28">
            <path d="M6 14 L 12 20 L 22 8" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div style={{ fontSize: 18, fontWeight: 600, color: TOKENS.ink }}>Witamy na mapie</div>
        <div style={{ fontSize: 14, color: TOKENS.soft, marginTop: 6, maxWidth: 260 }}>
          (Demo: tutaj ładowałaby się mapa cen.)
        </div>
        <button onClick={onReset} style={{
          marginTop: 28, padding: '10px 20px', borderRadius: 999,
          border: '1.5px solid ' + TOKENS.hair, background: '#fff', color: TOKENS.ink70,
          fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
        }}>↺ Odtwórz powitanie</button>
      </div>
    </div>
  );
}

// Static "frozen" card renderer (no buttons interactive — for grid views)
function StaticCard({ index }) {
  const card = CARDS[index];
  return (
    <WelcomeCard
      card={card}
      index={index}
      total={CARDS.length}
      onNext={() => {}}
      onBack={() => {}}
      onFinish={() => {}}
    />
  );
}

window.LitroCarousel = { WelcomeCarousel, WelcomeCard, StaticCard, CARDS, Dots, PrimaryBtn, SecondaryBtn };
