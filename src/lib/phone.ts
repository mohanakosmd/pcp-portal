// US (NANP) phone formatting + validation, shared by the signup and
// create-case forms. Pure string helpers with no server-only imports, so they
// are safe to use inside "use client" components.

/** Digits only, with a leading US country code (1) dropped, capped at 10. */
export function usPhoneDigits(input: string): string {
  let d = (input || "").replace(/\D/g, "");
  // The formatter always renders a "+1 " prefix and NANP national numbers never
  // start with 1, so a single leading 1 is always the country code — drop it
  // unconditionally. (Stripping only when length > 10 left the field stuck:
  // deleting a digit dropped the count to 10, the "+1"'s 1 was re-read as a
  // national digit, and the value reformatted straight back.)
  if (d.startsWith("1")) d = d.slice(1);
  return d.slice(0, 10);
}

/**
 * Progressive formatter for as-you-type input. Produces forms like
 * "+1 (555", "+1 (555) 123", "+1 (555) 123-4567". Empty input stays empty so
 * the field can be cleared.
 */
export function formatUsPhone(input: string): string {
  const d = usPhoneDigits(input);
  if (!d) return "";
  const area = d.slice(0, 3);
  const prefix = d.slice(3, 6);
  const line = d.slice(6, 10);
  if (d.length <= 3) return `+1 (${area}`;
  if (d.length <= 6) return `+1 (${area}) ${prefix}`;
  return `+1 (${area}) ${prefix}-${line}`;
}

/**
 * National-format progressive formatter (no country code, since that's shown
 * separately): "(555", "(555) 123", "(555) 123-4567".
 */
export function formatUsPhoneNational(input: string): string {
  const d = usPhoneDigits(input);
  if (!d) return "";
  const area = d.slice(0, 3);
  const prefix = d.slice(3, 6);
  const line = d.slice(6, 10);
  if (d.length <= 3) return `(${area}`;
  if (d.length <= 6) return `(${area}) ${prefix}`;
  return `(${area}) ${prefix}-${line}`;
}

/**
 * True for a complete US number: 10 digits whose area code starts 2-9
 * (NANP area codes never start with 0 or 1).
 */
export function isValidUsPhone(input: string): boolean {
  return /^[2-9]\d{9}$/.test(usPhoneDigits(input));
}
