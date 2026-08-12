import type {
  ProvenancedField,
  ProvenancedRecord,
  ProvenanceSource,
} from './provenance.js';

/**
 * What the model could determine about a field.
 *
 * The three states are deliberately distinct. "The bag doesn't say" and "I
 * couldn't read it" are both absences, but only the second is worth asking the
 * user about — collapsing them into null would make the review screen nag about
 * every field a roaster simply never printed.
 */
export type ExtractedField =
  | { readonly status: 'printed'; readonly value: unknown; readonly confidence: number }
  | { readonly status: 'not_printed' }
  | { readonly status: 'illegible' };

export type Extraction = Readonly<Record<string, ExtractedField>>;

/**
 * Convert an extraction into a patch suitable for `mergeProvenanced`.
 */
export function toProvenancePatch(
  extraction: Extraction,
  source: ProvenanceSource,
): ProvenancedRecord {
  const patch: Record<string, ProvenancedField> = {};

  for (const [key, field] of Object.entries(extraction)) {
    if (field.status === 'printed') {
      patch[key] = { value: field.value, source, confidence: field.confidence };
    }
  }

  return patch;
}

/**
 * Below this, a reading is shown as uncertain rather than presented as fact.
 * Tuned against real bags rather than derived — expect to move it.
 */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Field names the review screen should ask the user about: anything that was
 * there but could not be read, plus anything read without much confidence.
 *
 * Deliberately excludes fields the roaster never printed. Those are not gaps
 * in the extraction, and flagging them would train the user to dismiss the
 * warnings that do matter.
 */
export function fieldsNeedingAttention(
  extraction: Extraction,
  confidenceThreshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
): string[] {
  return Object.entries(extraction)
    .filter(([, field]) => {
      switch (field.status) {
        case 'illegible':
          return true;
        case 'printed':
          return field.confidence < confidenceThreshold;
        case 'not_printed':
          return false;
        default:
          // A status we do not recognise. The value is too unreliable to
          // merge, but dropping the field silently would lose it altogether,
          // so surface it for the user to resolve.
          return true;
      }
    })
    .map(([key]) => key);
}
