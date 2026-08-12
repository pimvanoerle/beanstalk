/** An altitude, always in metres. Single values are stored as a zero-width range. */
export interface AltitudeRange {
  readonly minM: number;
  readonly maxM: number;
}

const METRES_PER_FOOT = 0.3048;

/**
 * Digits plus any thousands separators, so "5,200" is not read as 5.
 *
 * A separator only counts when followed by exactly three digits, which is what
 * distinguishes the European "1.600" (one thousand six hundred) from a decimal.
 */
const NUMBER_SOURCE = String.raw`\d+(?:[.,]\d{3})*`;
const NUMBER_PATTERN = new RegExp(NUMBER_SOURCE);

/** Two numbers joined by a hyphen, dash or the word "to". */
const RANGE_PATTERN = new RegExp(
  `(${NUMBER_SOURCE})\\s*(?:[-–—]|\\bto\\b)\\s*(${NUMBER_SOURCE})`,
  'i',
);

function parseNumber(text: string | undefined): number {
  return Number((text ?? '').replaceAll(/[.,]/g, ''));
}

/**
 * Parse an altitude as printed on a coffee bag into metres.
 *
 * Bags print feet and metres interchangeably, so the unit is inferred from the
 * text. Normalising here rather than at read time is what stops a list sorting
 * wrong later.
 */
export function normaliseAltitude(input: string): AltitudeRange {
  // Anchored on a preceding digit rather than a word boundary: "5200ft" has no
  // boundary between the 0 and the f, and anchoring on the unit alone would
  // match any word ending in "ft".
  const isFeet = /\d\s*(?:ft|feet)\b/i.test(input);
  const toMetres = (value: number): number =>
    isFeet ? Math.round(value * METRES_PER_FOOT) : value;

  // A pair only counts as a range when a separator joins the two numbers.
  // Without this, an unrelated number elsewhere in the string — a harvest
  // year, most often — would silently become the altitude ceiling.
  const range = RANGE_PATTERN.exec(input);
  if (range !== null) {
    const [, low, high] = range;
    const a = toMetres(parseNumber(low));
    const b = toMetres(parseNumber(high));
    // Bags are occasionally printed high-to-low. Callers sort and filter on
    // these, so minM <= maxM has to hold regardless of print order.
    return { minM: Math.min(a, b), maxM: Math.max(a, b) };
  }

  const single = NUMBER_PATTERN.exec(input)?.[0];
  if (single === undefined) {
    throw new Error(`no altitude found in ${JSON.stringify(input)}`);
  }

  const metres = toMetres(parseNumber(single));
  return { minM: metres, maxM: metres };
}
