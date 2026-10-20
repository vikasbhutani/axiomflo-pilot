import { motionAllowed } from '../hooks/useMotion';

const RIPPLE_HOSTS = '.btn-primary, .btn-secondary, .btn-danger, .ripple-host';

/**
 * Adds a Material-style ink ripple to buttons when they're pressed: a circle that spreads from the
 * pointer and fades. One listener covers every current and future button; nothing runs with reduced motion.
 */
export function installRipple(root: Document = document): () => void {
  const onPointerDown = (e: PointerEvent) => {
    // Only the main button (or a touch or pen press) ripples.
    if (e.button || !motionAllowed()) return;
    const host = (e.target as Element | null)?.closest<HTMLElement>(RIPPLE_HOSTS);
    if (!host || host.matches(':disabled, [aria-disabled="true"]')) return;
    const rect = host.getBoundingClientRect();
    // Big enough to cover the farthest corner from where the pointer landed.
    const size = 2 * Math.hypot(Math.max(e.clientX - rect.left, rect.right - e.clientX), Math.max(e.clientY - rect.top, rect.bottom - e.clientY));
    const ink = root.createElement('span');
    ink.className = 'ripple';
    ink.setAttribute('aria-hidden', 'true');
    Object.assign(ink.style, { width: `${size}px`, height: `${size}px`, left: `${e.clientX - rect.left - size / 2}px`, top: `${e.clientY - rect.top - size / 2}px` });
    ink.addEventListener('animationend', () => ink.remove(), { once: true });
    host.appendChild(ink);
  };
  root.addEventListener('pointerdown', onPointerDown);
  return () => root.removeEventListener('pointerdown', onPointerDown);
}
