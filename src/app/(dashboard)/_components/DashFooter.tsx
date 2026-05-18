export function DashFooter() {
  return (
    <footer className="dash-page-footer" role="contentinfo">
      <div className="dash-page-footer__inner">
        <div className="dash-page-footer__row">
          <span className="dash-page-footer__label">Security standard</span>
          <span className="dash-page-footer__sep" aria-hidden="true" />
          <span
            className="dash-page-footer__hipaa"
            aria-label="HIPAA compliant and encrypted"
          >
            <svg
              className="dash-page-footer__lock"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2v-8a2 2 0 00-2-2h-1V7a5 5 0 00-5-5z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path d="M12 14v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            HIPAA Compliant &amp; Encrypted
          </span>
          <span className="dash-page-footer__sep" aria-hidden="true" />
          <span className="dash-page-footer__note">
            PHI processed per applicable privacy &amp; security requirements.
          </span>
        </div>
      </div>
    </footer>
  );
}
