import type { TaughtClass } from "../types";

/** Class code, plus the school name when the list spans several schools. */
export function classLabel(c: TaughtClass, all: TaughtClass[]): string {
  const multiSchool = new Set(all.map((x) => x.school_id)).size > 1;
  return multiSchool ? `${c.code} — ${c.school_name}` : c.code;
}
