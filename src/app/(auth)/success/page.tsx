import Link from "next/link";

export default function SuccessPage() {
  return (
    <div className="success-card" role="status" aria-live="polite">
      <div className="success-card__accent" aria-hidden="true" />

      <div className="success-badge" aria-hidden="true">
        <span className="success-badge__pulse" />
        <span className="success-badge__pulse success-badge__pulse--delayed" />
        <span className="success-badge__core">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M20 6L9 17l-5-5"
              stroke="#ffffff"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>

      <p className="success-card__eyebrow">Password updated</p>
      <h2 className="success-card__title">You&apos;re ready to sign in again</h2>
      <p className="success-card__lead">
        Your password was changed successfully. Use your new credentials the next time you open
        PCP Portal.
      </p>

      <ul className="success-card__list">
        <li>
          <span className="success-card__list-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2" />
              <path
                d="M4.5 8.2l2.3 2.2L11.5 5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span>Your session stays protected with the same HIPAA-grade security.</span>
        </li>
        <li>
          <span className="success-card__list-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2" />
              <path
                d="M4.5 8.2l2.3 2.2L11.5 5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span>Return to login to open your home page.</span>
        </li>
      </ul>

      <Link
        href="/login"
        className="action-btn success-card__cta"
        aria-label="Continue to login"
      >
        <span>Continue to login</span>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M2.33334 7H11.6667M11.6667 7L7.00001 2.33333M11.6667 7L7.00001 11.6667"
            stroke="white"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Link>
    </div>
  );
}
