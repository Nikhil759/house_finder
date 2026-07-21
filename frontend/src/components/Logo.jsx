/**
 * Inline version of public/icon.svg (the "radar" mark). Inlined — rather than
 * <img src="/icon.svg" /> — so its rings/dot/arm can pick up var(--color-accent)
 * and react to the active city (icon.svg itself stays static amber; it's only
 * used for the favicon/PWA manifest, which can't be dynamically recolored).
 */
export default function Logo({ size = 28 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="NestIQ"
      style={{ flexShrink: 0 }}
    >
      <rect width="512" height="512" rx="100" fill="#0f0f13" />
      <circle cx="256" cy="256" r="224" fill="none" style={{ stroke: 'var(--color-accent)' }} strokeWidth="16" />
      <circle cx="256" cy="256" r="128" fill="none" style={{ stroke: 'var(--color-accent)' }} strokeWidth="12" opacity="0.6" />
      <circle cx="256" cy="256" r="40" style={{ fill: 'var(--color-accent)' }} />
      <line x1="256" y1="256" x2="448" y2="96" style={{ stroke: 'var(--color-accent)' }} strokeWidth="14" opacity="0.8" strokeLinecap="round" />
    </svg>
  );
}
