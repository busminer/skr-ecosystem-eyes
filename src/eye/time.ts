// The Blink window's clock, shared by the panel that blinks and the pupil
// that counts down to it.

// The server says when the window opens and closes. Whether it says it as an
// ISO string, epoch seconds or epoch millis is not the screen's business.
export function epochMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1_000 : value;
  if (typeof value === 'string' && value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1_000 : numeric;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

// HH:MM:SS, hours left to grow past 24 rather than folded into days: the
// window is daily, so the number is never large and a "1d" would read as an
// error beside the seconds ticking under it.
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1_000));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

// The server counts the day's blinks by UTC hour, because a Blink day is a
// UTC day. The phone shows the day in its own time: the UTC hour of `day`
// (YYYY-MM-DD) becomes the local hour it fell in, and the twenty-four counts
// are laid out again so the row runs from the phone's midnight. A day that
// does not parse is left as it came.
export function localHourOf(day: string, utcHour: number): number {
  const [year = NaN, month = NaN, date = NaN] = String(day ?? '').split('-').map(Number);
  if (![year, month, date].every(Number.isFinite)) return utcHour;
  const hour = new Date(Date.UTC(year, month - 1, date, utcHour)).getHours();
  return Number.isFinite(hour) ? hour : utcHour;
}

export function pulseInPhoneTime(day: string, utcHours: number[]): number[] {
  const local = new Array<number>(24).fill(0);
  utcHours.forEach((count, utcHour) => {
    const hour = localHourOf(day, utcHour);
    local[hour] = (local[hour] ?? 0) + (Number(count) || 0);
  });
  return local;
}
