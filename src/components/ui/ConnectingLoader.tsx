import { useId, type CSSProperties } from 'react';

const HUB = { x: 180, y: 130 };
const R = 22;

// Clockwise from the top: the hub reaches out to one provider at a time.
const NODES = [
  { id: 'openai', x: 180, y: 34 },
  { id: 'gemini', x: 304, y: 130 },
  { id: 'slack', x: 180, y: 226 },
  { id: 'anthropic', x: 56, y: 130 },
] as const;

/** A clockwise curl from the hub's centre to the edge of a provider node. */
function wirePath(n: { x: number; y: number }) {
  const dx = n.x - HUB.x;
  const dy = n.y - HUB.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const cx = HUB.x + dx * 0.5 - uy * 34;
  const cy = HUB.y + dy * 0.5 + ux * 34;
  return `M${HUB.x} ${HUB.y} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${(n.x - ux * R).toFixed(1)} ${(n.y - uy * R).toFixed(1)}`;
}

function Glyph({ id, gradientId }: { id: (typeof NODES)[number]['id']; gradientId: string }) {
  switch (id) {
    case 'openai':
      return (
        <g fill="none" stroke="#0b1b33" strokeWidth="1.7">
          {[0, 120, 240].map((deg) => (
            <rect key={deg} x="8.2" y="3.2" width="7.6" height="13" rx="3.8" transform={`rotate(${deg} 12 12)`} />
          ))}
        </g>
      );
    case 'gemini':
      return <path fill={`url(#${gradientId})`} d="M12 2C12.6 7.4 16.6 11.4 22 12 16.6 12.6 12.6 16.6 12 22 11.4 16.6 7.4 12.6 2 12 7.4 11.4 11.4 7.4 12 2Z" />;
    case 'anthropic':
      return (
        <path
          stroke="#d97757"
          strokeWidth="2.2"
          strokeLinecap="round"
          d="M12 3v6M12 15v6M3 12h6M15 12h6M5.6 5.6l4.2 4.2M14.2 14.2l4.2 4.2M18.4 5.6l-4.2 4.2M9.8 14.2l-4.2 4.2"
        />
      );
    case 'slack':
      return (
        <>
          <rect x="8.4" y="2" width="3.4" height="11" rx="1.7" fill="#36c5f0" />
          <rect x="11" y="8.4" width="11" height="3.4" rx="1.7" fill="#2eb67d" />
          <rect x="12.2" y="11" width="3.4" height="11" rx="1.7" fill="#ecb22e" />
          <rect x="2" y="12.2" width="11" height="3.4" rx="1.7" fill="#e01e5a" />
        </>
      );
  }
}

/** The AxiomFlo mark wiring up to each AI provider and app in turn. Styles live in index.css (.connecting-loader). */
export function ConnectingLoader({ className = '' }: { className?: string }) {
  const gradientId = `gemini-${useId().replace(/:/g, '')}`;
  return (
    <svg viewBox="30 8 300 244" className={`connecting-loader ${className}`} aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4f8df5" />
          <stop offset=".55" stopColor="#7b6cf0" />
          <stop offset="1" stopColor="#c06ee0" />
        </linearGradient>
      </defs>
      {NODES.map((n, i) => {
        const d = wirePath(n);
        const style = { '--i': i } as CSSProperties;
        return (
          <g key={n.id}>
            <path d={d} className="cl-track" />
            <path d={d} className="cl-wire" pathLength={1} style={style} />
            <path d={d} className="cl-pulse" pathLength={1} style={style} />
          </g>
        );
      })}
      {NODES.map((n, i) => (
        <g key={n.id} className="cl-node" style={{ '--i': i } as CSSProperties}>
          <circle cx={n.x} cy={n.y} r={R} className="cl-node-bg" />
          <circle cx={n.x} cy={n.y} r={R + 3} className="cl-node-glow" />
          <svg x={n.x - 12} y={n.y - 12} width="24" height="24" viewBox="0 0 24 24">
            <Glyph id={n.id} gradientId={gradientId} />
          </svg>
        </g>
      ))}
      <rect x={HUB.x - 34} y={HUB.y - 34} width="68" height="68" rx="17" className="cl-hubring" />
      <svg x={HUB.x - 30} y={HUB.y - 30} width="60" height="60" viewBox="0 0 32 32">
        <rect width="32" height="32" rx="7" fill="#132a4a" />
        <path d="M8 23 L16 8 L24 23" fill="none" stroke="#2dd4bf" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M11.5 17.5 H20.5" stroke="#2dd4bf" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </svg>
  );
}
