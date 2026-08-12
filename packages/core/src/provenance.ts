/** Where a field value came from. Ordering matters — see SOURCE_RANK. */
export type ProvenanceSource = 'bag_photo' | 'roaster_page' | 'user';

export interface ProvenancedField {
  readonly value: unknown;
  readonly source: ProvenanceSource;
  readonly confidence: number;
}

/** A set of fields, each carrying its own provenance. */
export type ProvenancedRecord = Readonly<Record<string, ProvenancedField>>;

/**
 * Precedence between sources. A field is only replaced by something that
 * outranks what is already recorded, which is what makes a manual correction
 * permanent: re-running enrichment can never undo it.
 */
const SOURCE_RANK: Readonly<Record<ProvenanceSource, number>> = {
  bag_photo: 1,
  roaster_page: 2,
  user: 3,
};

/**
 * Merge an enrichment patch into a record, resolving each field by provenance.
 */
export function mergeProvenanced(
  base: ProvenancedRecord,
  patch: ProvenancedRecord,
): ProvenancedRecord {
  const merged: Record<string, ProvenancedField> = { ...base };

  for (const [key, candidate] of Object.entries(patch)) {
    if (outranks(candidate, merged[key])) {
      merged[key] = candidate;
    }
  }

  return merged;
}

function outranks(
  candidate: ProvenancedField,
  incumbent: ProvenancedField | undefined,
): boolean {
  const candidateRank = SOURCE_RANK[candidate.source] as number | undefined;
  // A source we cannot rank is refused outright rather than recorded as
  // something nothing could ever displace. The types forbid this, but records
  // round-trip through JSONB, so it has to hold at runtime too.
  if (candidateRank === undefined) {
    return false;
  }

  if (incumbent === undefined) {
    return true;
  }

  const incumbentRank = SOURCE_RANK[incumbent.source] as number | undefined ?? 0;
  if (candidateRank !== incumbentRank) {
    return candidateRank > incumbentRank;
  }

  // Same source re-reporting: only a strictly more confident reading displaces
  // the incumbent. Ties keeping what is already there is what makes re-applying
  // the same patch a no-op.
  return candidate.confidence > incumbent.confidence;
}
