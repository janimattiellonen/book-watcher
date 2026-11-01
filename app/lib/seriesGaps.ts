/**
 * The whole part numbers missing from a series (series spec US-S4): those between 1 and
 * the highest known part that no book has. A part like 2.5 fills no whole number and
 * is never missing itself. Parts after the highest known one can't be seen, so they
 * are never listed.
 */
export function seriesGaps(parts: (number | null)[]): number[] {
  const known = parts.filter((part): part is number => part !== null);
  if (known.length === 0) return [];
  const present = new Set(known);
  const gaps: number[] = [];
  for (let part = 1; part <= Math.floor(Math.max(...known)); part++) {
    if (!present.has(part)) gaps.push(part);
  }
  return gaps;
}
