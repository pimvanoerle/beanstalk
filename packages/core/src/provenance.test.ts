import { describe, expect, test } from 'vitest';

import { mergeProvenanced, type ProvenanceSource } from './provenance.js';

describe('mergeProvenanced', () => {
  test('records a field from the patch with its provenance', () => {
    const merged = mergeProvenanced(
      {},
      { process: { value: 'washed', source: 'bag_photo', confidence: 0.8 } },
    );

    expect(merged).toEqual({
      process: { value: 'washed', source: 'bag_photo', confidence: 0.8 },
    });
  });

  test('an automated source never overwrites a user edit', () => {
    const merged = mergeProvenanced(
      { producer: { value: 'Tesfaye Bekele', source: 'user', confidence: 1 } },
      { producer: { value: 'Unknown', source: 'roaster_page', confidence: 0.95 } },
    );

    expect(merged.producer).toEqual({
      value: 'Tesfaye Bekele',
      source: 'user',
      confidence: 1,
    });
  });

  test('a more confident reading from the same source wins', () => {
    const merged = mergeProvenanced(
      { altitudeMinM: { value: 1600, source: 'bag_photo', confidence: 0.4 } },
      { altitudeMinM: { value: 1900, source: 'bag_photo', confidence: 0.9 } },
    );

    expect(merged.altitudeMinM?.value).toBe(1900);
  });

  test('a higher-ranked source replaces a lower-ranked one', () => {
    const merged = mergeProvenanced(
      { process: { value: 'natural', source: 'bag_photo', confidence: 0.9 } },
      { process: { value: 'washed', source: 'roaster_page', confidence: 0.5 } },
    );

    // Rank beats confidence: the roaster's own page outranks a blurry bag.
    expect(merged.process).toEqual({
      value: 'washed',
      source: 'roaster_page',
      confidence: 0.5,
    });
  });

  test('an equally confident reading from the same source is ignored', () => {
    const merged = mergeProvenanced(
      { altitudeMinM: { value: 1600, source: 'bag_photo', confidence: 0.8 } },
      { altitudeMinM: { value: 1900, source: 'bag_photo', confidence: 0.8 } },
    );

    expect(merged.altitudeMinM?.value).toBe(1600);
  });

  test('re-applying the same patch is a no-op', () => {
    const patch = {
      process: { value: 'washed', source: 'bag_photo', confidence: 0.8 },
    } as const;

    const once = mergeProvenanced({}, patch);
    const twice = mergeProvenanced(once, patch);

    expect(twice).toEqual(once);
  });

  test('fields absent from the patch are left alone', () => {
    const merged = mergeProvenanced(
      { region: { value: 'Guji', source: 'bag_photo', confidence: 0.6 } },
      { process: { value: 'washed', source: 'bag_photo', confidence: 0.8 } },
    );

    expect(merged.region?.value).toBe('Guji');
    expect(merged.process?.value).toBe('washed');
  });

  // The type system forbids this, but records round-trip through Postgres
  // JSONB as unknown — an old source name surviving a schema change lands here.
  test('ignores a field whose source is not recognised', () => {
    const junk = {
      x: {
        value: 'junk',
        source: 'some_blog' as ProvenanceSource,
        confidence: 0.99,
      },
    };

    expect(mergeProvenanced({}, junk).x).toBeUndefined();
    expect(
      mergeProvenanced(
        { x: { value: 'bag', source: 'bag_photo', confidence: 0.1 } },
        junk,
      ).x?.value,
    ).toBe('bag');
  });

  test('distinct sources merge to the same result in either order', () => {
    const bag = {
      x: { value: 'bag', source: 'bag_photo', confidence: 0.9 },
    } as const;
    const page = {
      x: { value: 'page', source: 'roaster_page', confidence: 0.1 },
    } as const;

    expect(mergeProvenanced(mergeProvenanced({}, bag), page)).toEqual(
      mergeProvenanced(mergeProvenanced({}, page), bag),
    );
  });

  test('does not mutate the base record', () => {
    const base = {
      process: { value: 'natural', source: 'bag_photo', confidence: 0.5 },
    } as const;

    mergeProvenanced(base, {
      process: { value: 'washed', source: 'user', confidence: 1 },
    });

    expect(base.process.value).toBe('natural');
  });
});
