/**
 * Integer cents in, display string out. The API never sends a float, so no
 * arithmetic happens here: a value is divided and padded, never multiplied, so
 * a total can only ever be the exact number of cents the server sent.
 */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const value = Math.abs(cents);
  return `${sign}$${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}
