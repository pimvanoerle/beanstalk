import { describe, expect, test } from 'vitest';

import { bestMatch, normaliseCoffeeName, rankCandidates } from './identity.js';

describe('normaliseCoffeeName', () => {
  test('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normaliseCoffeeName('  Ethiopia   GUJI, Natural!  ')).toBe(
      'ethiopia guji natural',
    );
  });

  test('strips diacritics', () => {
    expect(normaliseCoffeeName('Café Doña Rosa')).toBe('cafe dona rosa');
  });

  test('drops packaging noise and weights', () => {
    expect(normaliseCoffeeName('Ethiopia Guji — Whole Bean Coffee 250g')).toBe(
      'ethiopia guji',
    );
  });

  test('keeps brew-method words, which distinguish real products', () => {
    // A roaster may sell the same lot as separate filter and espresso roasts.
    expect(normaliseCoffeeName('Guji Filter')).toBe('guji filter');
    expect(normaliseCoffeeName('Guji Espresso')).toBe('guji espresso');
  });
});

describe('rankCandidates', () => {
  test('an identical name at the same roaster is a certain match', () => {
    const matches = rankCandidates(
      { roasterId: 'friedhats', name: 'Ethiopia Guji' },
      [
        { coffeeId: 'c1', roasterId: 'friedhats', name: 'Ethiopia Guji' },
      ],
    );

    expect(matches).toEqual([{ coffeeId: 'c1', score: 1 }]);
  });

  test('a near match scores between zero and certain', () => {
    const [match] = rankCandidates(
      { roasterId: 'r', name: 'Ethiopia Guji Natural' },
      [{ coffeeId: 'near', roasterId: 'r', name: 'Ethiopia Guji' }],
    );

    expect(match?.score).toBeGreaterThan(0.5);
    expect(match?.score).toBeLessThan(1);
  });

  test('returns candidates best first', () => {
    const matches = rankCandidates(
      { roasterId: 'r', name: 'Ethiopia Guji Natural' },
      [
        { coffeeId: 'unrelated', roasterId: 'r', name: 'Colombia Huila Pink Bourbon' },
        { coffeeId: 'near', roasterId: 'r', name: 'Ethiopia Guji' },
        { coffeeId: 'exact', roasterId: 'r', name: 'Ethiopia Guji Natural' },
      ],
    );

    expect(matches.map((m) => m.coffeeId)).toEqual(['exact', 'near', 'unrelated']);
  });

  test('a coffee from a different roaster is never a candidate', () => {
    const matches = rankCandidates(
      { roasterId: 'friedhats', name: 'Ethiopia Guji' },
      [{ coffeeId: 'c1', roasterId: 'manhattan', name: 'Ethiopia Guji' }],
    );

    expect(matches).toEqual([]);
  });

  // Both of these normalise to the empty string. Treating that as a perfect
  // match would auto-link two unrelated coffees with full confidence.
  test('a name that normalises to nothing never matches', () => {
    expect(
      rankCandidates({ roasterId: 'r', name: '250g' }, [
        { coffeeId: 'c1', roasterId: 'r', name: 'Whole Bean Coffee' },
      ]),
    ).toEqual([]);
  });

  test('a differing harvest year rules out an identical name', () => {
    // Same line, different lot. The data model says a coffee is the lot.
    const matches = rankCandidates(
      { roasterId: 'r', name: 'Ethiopia Guji', harvestYear: 2025 },
      [{ coffeeId: 'c1', roasterId: 'r', name: 'Ethiopia Guji', harvestYear: 2024 }],
    );

    expect(matches).toEqual([]);
  });

  test('a harvest year missing on either side does not rule out a match', () => {
    expect(
      rankCandidates({ roasterId: 'r', name: 'Ethiopia Guji' }, [
        { coffeeId: 'c1', roasterId: 'r', name: 'Ethiopia Guji', harvestYear: 2024 },
      ]),
    ).toEqual([{ coffeeId: 'c1', score: 1 }]);

    expect(
      rankCandidates({ roasterId: 'r', name: 'Ethiopia Guji', harvestYear: 2024 }, [
        { coffeeId: 'c1', roasterId: 'r', name: 'Ethiopia Guji' },
      ]),
    ).toEqual([{ coffeeId: 'c1', score: 1 }]);
  });
});

describe('bestMatch', () => {
  test('returns a confident match so the caller can link without asking', () => {
    expect(
      bestMatch({ roasterId: 'r', name: 'Ethiopia Guji' }, [
        { coffeeId: 'c1', roasterId: 'r', name: 'ETHIOPIA GUJI 250g' },
      ]),
    ).toEqual({ coffeeId: 'c1', score: 1 });
  });

  test('returns null when nothing is confident enough', () => {
    // A plausible-but-uncertain candidate is the user's call, not ours.
    expect(
      bestMatch({ roasterId: 'r', name: 'Ethiopia Guji Natural' }, [
        { coffeeId: 'c1', roasterId: 'r', name: 'Ethiopia Guji' },
      ]),
    ).toBeNull();
  });

  test('returns null when there are no candidates at all', () => {
    expect(bestMatch({ roasterId: 'r', name: 'Ethiopia Guji' }, [])).toBeNull();
  });
});
