export function BrandLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
      <g fill="none" stroke="var(--accent-green)" strokeWidth="1.6">
        <path d="M4 4 L4 16 L6 16" strokeLinecap="round" />
        <path d="M16 4 L16 16 L14 16" strokeLinecap="round" />
      </g>
      <circle cx="10" cy="10" r="1.8" fill="var(--accent-blue)" />
      <circle
        cx="10"
        cy="10"
        r="4.2"
        fill="none"
        stroke="var(--accent-blue)"
        strokeWidth="0.8"
        opacity="0.5"
      />
    </svg>
  );
}
