import { describe, expect, test } from 'vitest';

import {
  fieldsNeedingAttention,
  toProvenancePatch,
  type Extraction,
} from './extraction.js';

describe('toProvenancePatch', () => {
  test('a printed field becomes a patch entry', () => {
    const patch = toProvenancePatch(
      { process: { status: 'printed', value: 'washed', confidence: 0.8 } },
      'bag_photo',
    );

    expect(patch).toEqual({
      process: { value: 'washed', source: 'bag_photo', confidence: 0.8 },
    });
  });

  test('a field the bag never printed is not in the patch', () => {
    const patch = toProvenancePatch({ producer: { status: 'not_printed' } }, 'bag_photo');

    expect(patch).toEqual({});
  });

  test('an illegible field is not in the patch', () => {
    const patch = toProvenancePatch({ altitude: { status: 'illegible' } }, 'bag_photo');

    // Nothing was read, so there is no value to record. It still needs the
    // user's attention — see fieldsNeedingAttention.
    expect(patch).toEqual({});
  });
});

describe('fieldsNeedingAttention', () => {
  test('flags an illegible field but not one the bag never printed', () => {
    const attention = fieldsNeedingAttention({
      altitude: { status: 'illegible' },
      producer: { status: 'not_printed' },
      process: { status: 'printed', value: 'washed', confidence: 0.95 },
    });

    // This is the whole point of the three states: the review screen should
    // ask about the smudged altitude and stay quiet about the producer the
    // roaster simply never listed.
    expect(attention).toEqual(['altitude']);
  });

  test('flags a printed field the model was unsure about', () => {
    const attention = fieldsNeedingAttention({
      altitude: { status: 'printed', value: 1900, confidence: 0.4 },
      process: { status: 'printed', value: 'washed', confidence: 0.95 },
    });

    expect(attention).toEqual(['altitude']);
  });

  test('does not flag a reading exactly at the threshold', () => {
    expect(
      fieldsNeedingAttention({
        altitude: { status: 'printed', value: 1900, confidence: 0.7 },
      }),
    ).toEqual([]);
  });

  // The model is untrusted and the schema will change. A status we do not
  // recognise must surface, not evaporate: the value is too unreliable to
  // merge, but silently losing the field is worse than asking about it.
  test('flags a field with an unrecognised status rather than dropping it', () => {
    const junk = {
      grower: { status: 'guessed', value: 'someone', confidence: 0.99 },
    } as unknown as Extraction;

    expect(toProvenancePatch(junk, 'bag_photo')).toEqual({});
    expect(fieldsNeedingAttention(junk)).toEqual(['grower']);
  });

  test('honours a caller-supplied confidence threshold', () => {
    const extraction = {
      process: { status: 'printed', value: 'washed', confidence: 0.8 },
    } as const;

    expect(fieldsNeedingAttention(extraction, 0.9)).toEqual(['process']);
    expect(fieldsNeedingAttention(extraction, 0.5)).toEqual([]);
  });
});
