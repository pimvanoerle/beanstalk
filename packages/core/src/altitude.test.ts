import { describe, expect, test } from 'vitest';

import { normaliseAltitude } from './altitude.js';

describe('normaliseAltitude', () => {
  test('reads a single value in metres above sea level', () => {
    expect(normaliseAltitude('1800 masl')).toEqual({ minM: 1800, maxM: 1800 });
  });

  test('converts feet to metres', () => {
    // 5200 ft = 1584.96 m
    expect(normaliseAltitude('5200 ft')).toEqual({ minM: 1585, maxM: 1585 });
  });

  test('ignores thousands separators', () => {
    expect(normaliseAltitude('5,200 ft')).toEqual({ minM: 1585, maxM: 1585 });
  });

  test('reads a range', () => {
    expect(normaliseAltitude('1600-1900 masl')).toEqual({
      minM: 1600,
      maxM: 1900,
    });
  });

  // Regression guard: en-dashes are what most specialty bags actually print,
  // and they already work because the separator is never matched as a digit.
  test('reads an en-dashed range with separators', () => {
    expect(normaliseAltitude('1,600–1,900 m.a.s.l.')).toEqual({
      minM: 1600,
      maxM: 1900,
    });
  });
});
