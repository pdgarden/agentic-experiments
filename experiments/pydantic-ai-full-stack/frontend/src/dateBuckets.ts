// Groups items by how recently they changed, in the viewer's local calendar days.

export type DateBucket = "Today" | "Yesterday" | "Previous 7 days" | "Older";

const ORDER: DateBucket[] = ["Today", "Yesterday", "Previous 7 days", "Older"];
const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** The bucket of one timestamp. Unparseable or future dates count as today. */
export function bucketOf(iso: string, now: Date): DateBucket {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "Today";
  // Round: a day across a DST change is 23 or 25 hours long.
  const days = Math.round((startOfDay(now) - startOfDay(new Date(time))) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days <= 7) return "Previous 7 days";
  return "Older";
}

/** Groups in fixed order (empty ones left out); items keep their order inside a group. */
export function groupByDate<T>(
  items: readonly T[],
  dateOf: (item: T) => string,
  now: Date,
): { label: DateBucket; items: T[] }[] {
  const groups = new Map<DateBucket, T[]>();
  for (const item of items) {
    const label = bucketOf(dateOf(item), now);
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }
  return ORDER.filter((label) => groups.has(label)).map((label) => ({
    label,
    items: groups.get(label) ?? [],
  }));
}
