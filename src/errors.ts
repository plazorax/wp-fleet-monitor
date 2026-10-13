/**
 * One line of text for a network error. Handles the shapes Node produces: an error `code`
 * that is not in the message, and the `AggregateError` with an empty message that
 * `net.connect` raises when every address of a host fails (IPv4 and IPv6).
 */
export function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  let text = error.message;
  if (text === '' && error instanceof AggregateError) {
    text = error.errors
      .map((inner: unknown) => (inner instanceof Error ? inner.message : String(inner)))
      .filter((message) => message !== '')
      .join('; ');
  }
  const code = (error as NodeJS.ErrnoException).code;
  if (code && !text.includes(code)) return text ? `${code} ${text}` : code;
  return text || error.name;
}
