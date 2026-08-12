/** An altitude, always in metres. Single values are stored as a zero-width range. */
export interface AltitudeRange {
  readonly minM: number;
  readonly maxM: number;
}

/**
 * Parse an altitude as printed on a coffee bag into metres.
 */
export function normaliseAltitude(input: string): AltitudeRange {
  const digits = /\d+/.exec(input)?.[0];
  if (digits === undefined) {
    throw new Error(`no altitude found in ${JSON.stringify(input)}`);
  }

  const value = Number(digits);
  return { minM: value, maxM: value };
}
