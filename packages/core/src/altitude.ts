/** An altitude, always in metres. Single values are stored as a zero-width range. */
export interface AltitudeRange {
  readonly minM: number;
  readonly maxM: number;
}

const METRES_PER_FOOT = 0.3048;

/** Digits plus any thousands separators, so "5,200" is not read as 5. */
const NUMBER_SOURCE = String.raw`\d[\d,]*`;
const NUMBER_PATTERN = new RegExp(NUMBER_SOURCE);

/** Two numbers joined by a hyphen, dash or the word "to". */
const RANGE_PATTERN = new RegExp(
  `(${NUMBER_SOURCE})\\s*(?:[-–—]|\\bto\\b)\\s*(${NUMBER_SOURCE})`,
  'i',
);

function parseNumber(text: string | undefined): number {
  return Number((text ?? '').replaceAll(',', ''));
}

/**
 * Parse an altitude as printed on a coffee bag into metres.
 *
 * Bags print feet and metres interchangeably, so the unit is inferred from the
 * text. Normalising here rather than at read time is what stops a list sorting
 * wrong later.
 */
export function normaliseAltitude(input: string): AltitudeRange {
  const isFeet = /\bft\b/i.test(input);
  const toMetres = (value: number): number =>
    isFeet ? Math.round(value * METRES_PER_FOOT) : value;

  // A pair only counts as a range when a separator joins the two numbers.
  // Without this, an unrelated number elsewhere in the string — a harvest
  // year, most often — would silently become the altitude ceiling.
  const range = RANGE_PATTERN.exec(input);
  if (range !== null) {
    const [, low, high] = range;
    return { minM: toMetres(parseNumber(low)), maxM: toMetres(parseNumber(high)) };
  }

  const single = NUMBER_PATTERN.exec(input)?.[0];
  if (single === undefined) {
    throw new Error(`no altitude found in ${JSON.stringify(input)}`);
  }

  const metres = toMetres(parseNumber(single));
  return { minM: metres, maxM: metres };
}
