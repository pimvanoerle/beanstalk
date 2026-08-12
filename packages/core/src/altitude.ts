/** An altitude, always in metres. Single values are stored as a zero-width range. */
export interface AltitudeRange {
  readonly minM: number;
  readonly maxM: number;
}

const METRES_PER_FOOT = 0.3048;

/**
 * Parse an altitude as printed on a coffee bag into metres.
 *
 * Bags print feet and metres interchangeably, so the unit is inferred from the
 * text. Normalising here rather than at read time is what stops a list sorting
 * wrong later.
 */
export function normaliseAltitude(input: string): AltitudeRange {
  // Digits together with any thousands separators, so "5,200" does not
  // silently read as 5.
  const numbers = [...input.matchAll(/\d[\d,]*/g)].map((match) =>
    Number(match[0].replaceAll(',', '')),
  );

  const first = numbers.at(0);
  const last = numbers.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error(`no altitude found in ${JSON.stringify(input)}`);
  }

  const isFeet = /\bft\b/i.test(input);
  const toMetres = (value: number): number =>
    isFeet ? Math.round(value * METRES_PER_FOOT) : value;

  return { minM: toMetres(first), maxM: toMetres(last) };
}
