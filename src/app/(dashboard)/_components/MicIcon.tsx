// The mic glyph on every Speak-to-Text button (create-case, the case modal,
// and report remarks). Inherits color from the button via currentColor.
export function MicIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="4" width="6" height="10" rx="3" stroke="currentColor" strokeWidth="1.9" />
      <path
        d="M6.5 11.5V12a5.5 5.5 0 0011 0v-.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path d="M12 17.5V21" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M9 21h6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
