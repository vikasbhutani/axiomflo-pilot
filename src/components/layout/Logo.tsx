/** AxiomFlo wordmark. `tone="dark"` is for light backgrounds such as the sign-in pages. */
export function Logo({ className = '', tone = 'light' }: { className?: string; tone?: 'light' | 'dark' }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
        <rect width="32" height="32" rx="7" fill="#132a4a" />
        <path d="M8 23 L16 8 L24 23" fill="none" stroke="#2dd4bf" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M11.5 17.5 H20.5" stroke="#2dd4bf" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className={`text-lg font-semibold tracking-tight ${tone === 'dark' ? 'text-navy-900' : 'text-white'}`}>
        Axiom<span className={tone === 'dark' ? 'text-teal-700' : 'text-teal-300'}>Flo</span>
      </span>
    </span>
  );
}
