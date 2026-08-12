export { normaliseAltitude, type AltitudeRange } from './altitude.js';
export {
  DEFAULT_CONFIDENCE_THRESHOLD,
  fieldsNeedingAttention,
  toProvenancePatch,
  type ExtractedField,
  type Extraction,
} from './extraction.js';
export {
  AUTO_LINK_THRESHOLD,
  bestMatch,
  normaliseCoffeeName,
  rankCandidates,
  type CoffeeCandidate,
  type CoffeeIdentity,
  type CoffeeMatch,
} from './identity.js';
export {
  mergeProvenanced,
  type ProvenancedField,
  type ProvenancedRecord,
  type ProvenanceSource,
} from './provenance.js';
