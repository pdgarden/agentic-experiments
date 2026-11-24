import { describe, expect, it } from "vitest";
import { bucketOf, groupByDate } from "@/dateBuckets";

// Local time, so the test holds in any time zone.
const now = new Date(2026, 10, 24, 9, 30);
const at = (day: number, hour = 12) => new Date(2026, 10, day, hour).toISOString();

describe("bucketOf", () => {
  it("uses calendar days, not 24-hour windows", () => {
    expect(bucketOf(at(24, 0), now)).toBe("Today");
    expect(bucketOf(at(23, 23), now)).toBe("Yesterday");
    expect(bucketOf(at(23, 0), now)).toBe("Yesterday");
    expect(bucketOf(at(22), now)).toBe("Previous 7 days");
    expect(bucketOf(at(17), now)).toBe("Previous 7 days");
    expect(bucketOf(at(16), now)).toBe("Older");
    expect(bucketOf(new Date(2025, 0, 1).toISOString(), now)).toBe("Older");
  });

  it("puts future and invalid dates in today", () => {
    expect(bucketOf(at(25), now)).toBe("Today");
    expect(bucketOf("not a date", now)).toBe("Today");
  });
});

describe("groupByDate", () => {
  it("groups in fixed order, keeps item order and skips empty groups", () => {
    const items = [
      { id: "a", at: at(24, 9) },
      { id: "b", at: at(10) },
      { id: "c", at: at(24, 8) },
      { id: "d", at: at(20) },
    ];
    const groups = groupByDate(items, (item) => item.at, now);
    expect(groups.map((g) => [g.label, g.items.map((item) => item.id)])).toEqual([
      ["Today", ["a", "c"]],
      ["Previous 7 days", ["d"]],
      ["Older", ["b"]],
    ]);
  });

  it("returns nothing for no items", () => {
    expect(groupByDate([], () => "", now)).toEqual([]);
  });
});
