// Business dates follow Tashkent time. UTC "today" is the previous day between 00:00 and 05:00 local time.
export const BUSINESS_TIME_ZONE = 'Asia/Tashkent';

export function businessToday(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: BUSINESS_TIME_ZONE });
}

/** Calendar date of an ISO timestamp in business time. */
export function businessDateOf(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  return Number.isNaN(date.getTime()) ? '' : businessToday(date);
}

/** Real calendar date in YYYY-MM-DD between 2000 and 2100 (rejects values such as 2097-42-01). */
export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 2000 || year > 2100) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
}
