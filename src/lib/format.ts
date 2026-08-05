/**
 * Timestamp formatting for a mail list.
 *
 * Mail apps converge on the same rule because it is the right one: the more
 * recent something is, the more precisely you want it described. Today wants a
 * clock time, this week wants a weekday, older wants a date. Showing "14:32"
 * against something from March is useless, and "12/03/2026" against something
 * from an hour ago is worse.
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatListTime(epochSeconds: number, now = Date.now() / 1000): string {
  const date = new Date(epochSeconds * 1000);
  const delta = now - epochSeconds;

  // Clock time for today, so a glance distinguishes this morning from just now.
  if (delta < DAY && new Date(now * 1000).getDate() === date.getDate()) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  if (delta < 2 * DAY) return 'Yesterday';
  if (delta < 7 * DAY) return date.toLocaleDateString(undefined, { weekday: 'short' });
  if (date.getFullYear() === new Date(now * 1000).getFullYear()) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Full timestamp for a message header, where precision beats brevity. */
export function formatMessageTime(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Counts above 99 become "99+".
 *
 * A four-digit unread badge reflows the row it sits in and tells the reader
 * nothing they did not already know from three digits.
 */
export function formatCount(n: number): string {
  return n > 99 ? '99+' : String(n);
}
