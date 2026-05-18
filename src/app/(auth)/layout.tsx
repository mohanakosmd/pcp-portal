import "@/styles/auth.css";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="auth-shell">
      <aside className="auth-hero" aria-label="PCP Portal">
        <div className="auth-hero__overlay" aria-hidden="true" />
        <div className="auth-hero__content">
          <div className="auth-hero__brand">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="2" y="2" width="20" height="20" rx="4" fill="#ffffff" opacity="0.95" />
              <path d="M12 7.5V16.5M7.5 12H16.5" stroke="#0a3f7f" strokeWidth="2" strokeLinecap="round" />
              <path
                d="M17.5 5.5L19.5 7.5L17.5 9.5"
                stroke="#0a3f7f"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>PCP Portal</span>
          </div>
          <h1>
            Your health information,
            <br />
            shared with your doctors.
          </h1>
          <div className="auth-security">
            <div className="auth-security__icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 2L20 5V11C20 16 16.5 20.5 12 22C7.5 20.5 4 16 4 11V5L12 2Z"
                  fill="#6a50d8"
                />
                <path
                  d="M12 7V17M8 11H16"
                  stroke="#ffffff"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div className="auth-security__text">
              <span>SECURITY STANDARD</span>
              <strong>HIPAA Compliant &amp; Encrypted</strong>
            </div>
          </div>
        </div>
      </aside>

      <div className="auth-panel">
        <div className="auth-panel__main">{children}</div>
      </div>
    </div>
  );
}
