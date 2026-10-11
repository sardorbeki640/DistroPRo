// Business dates are local calendar days. toISOString() is UTC and shows yesterday's date
// in Tashkent between 00:00 and 05:00, so never use it for "today".
export function localToday(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
