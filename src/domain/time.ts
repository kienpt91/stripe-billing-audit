/** Calendar arithmetic without a Date object: the domain never touches the clock. */

const DAY = 86_400;

/** Whole days from `fromSeconds` to `toSeconds` (negative when `toSeconds` is earlier), rounded down. */
export function daysBetween(fromSeconds: number, toSeconds: number): number {
  return Math.floor((toSeconds - fromSeconds) / DAY);
}

/** `YYYY-MM-DD` (UTC) for epoch seconds, using the proleptic Gregorian calendar. */
export function isoDate(epochSeconds: number): string {
  const days = Math.floor(epochSeconds / DAY);
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** `YYYY-MM-DDTHH:MM:SSZ` (UTC). */
export function isoDateTime(epochSeconds: number): string {
  const secs = ((Math.floor(epochSeconds) % DAY) + DAY) % DAY;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${isoDate(epochSeconds)}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}Z`;
}
