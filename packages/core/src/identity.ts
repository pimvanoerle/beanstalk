/**
 * Reduce a printed coffee name to something comparable.
 *
 * Deliberately text-only. Roasters redesign bags — new colours, new layout,
 * new logo — without renaming the coffee, so any signal drawn from how the bag
 * looks would break exactly when the name did not.
 */
/**
 * Words that describe the packaging rather than the coffee.
 *
 * Deliberately excludes "filter" and "espresso": a roaster may sell the same
 * lot as two separate roasts, and collapsing those would merge two products
 * the user genuinely bought apart.
 */
const NOISE_WORDS = new Set([
  'coffee',
  'coffees',
  'bean',
  'beans',
  'whole',
  'ground',
]);

/** A bare weight such as 250g or 1kg. */
const WEIGHT_PATTERN = /^\d+(?:g|kg|oz|lb|lbs)$/;

export function normaliseCoffeeName(name: string): string {
  return name
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replaceAll(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((word) => word !== '' && !NOISE_WORDS.has(word) && !WEIGHT_PATTERN.test(word))
    .join(' ');
}

export interface CoffeeIdentity {
  readonly roasterId: string;
  readonly name: string;
  /** Absent when the bag did not state one. */
  readonly harvestYear?: number;
}

export interface CoffeeCandidate extends CoffeeIdentity {
  readonly coffeeId: string;
}

export interface CoffeeMatch {
  readonly coffeeId: string;
  /** 0 to 1. */
  readonly score: number;
}

/**
 * Score existing coffees against one just read off a bag, best first.
 *
 * Only ever compares within a single roaster, which keeps the candidate set to
 * a handful and makes a cheap similarity measure sufficient. This proposes
 * rather than decides: the caller auto-links a confident match and asks the
 * user about anything else.
 */
export function rankCandidates(
  target: CoffeeIdentity,
  candidates: readonly CoffeeCandidate[],
): CoffeeMatch[] {
  const targetName = normaliseCoffeeName(target.name);

  // Nothing distinguishing survived normalisation — a name of "250g", say.
  // Two such names are not a match, they are two absences, and treating them
  // as identical would auto-link unrelated coffees at full confidence.
  if (targetName === '') {
    return [];
  }

  return candidates
    .filter((candidate) => candidate.roasterId === target.roasterId)
    .filter((candidate) => sameLot(target, candidate))
    .map((candidate) => ({
      coffeeId: candidate.coffeeId,
      candidateName: normaliseCoffeeName(candidate.name),
    }))
    .filter(({ candidateName }) => candidateName !== '')
    .map(({ coffeeId, candidateName }) => ({
      coffeeId,
      score: similarity(targetName, candidateName),
    }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Score above which two bags are treated as the same coffee without asking.
 *
 * Set high on purpose. A wrong auto-link is invisible — two purchases quietly
 * merge into one coffee — whereas an unnecessary question costs one tap on a
 * screen the user is already looking at.
 */
export const AUTO_LINK_THRESHOLD = 0.9;

/**
 * The one candidate confident enough to link to automatically, or null when
 * the decision belongs to the user.
 */
export function bestMatch(
  target: CoffeeIdentity,
  candidates: readonly CoffeeCandidate[],
  threshold: number = AUTO_LINK_THRESHOLD,
): CoffeeMatch | null {
  const [best] = rankCandidates(target, candidates);
  return best !== undefined && best.score >= threshold ? best : null;
}

/**
 * Harvest year as a discriminator, not a signal.
 *
 * Two bags of the same line from different harvests are different lots, and a
 * coffee is the lot. But bags often omit the year entirely, so silence on
 * either side must not count against a match.
 */
function sameLot(target: CoffeeIdentity, candidate: CoffeeIdentity): boolean {
  if (target.harvestYear === undefined || candidate.harvestYear === undefined) {
    return true;
  }
  return target.harvestYear === candidate.harvestYear;
}

/**
 * Sørensen–Dice over character bigrams.
 *
 * Chosen over edit distance because it tolerates both OCR noise and reordered
 * or added words — "Guji, Ethiopia" against "Ethiopia Guji Lot 12" — without
 * needing tuning. Cheap enough that scoring a roaster's whole catalogue on
 * every capture is free.
 */
function similarity(a: string, b: string): number {
  if (a === b) {
    return 1;
  }

  const left = bigrams(a);
  const right = bigrams(b);
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const pool = new Map<string, number>();
  for (const gram of left) {
    pool.set(gram, (pool.get(gram) ?? 0) + 1);
  }

  let shared = 0;
  for (const gram of right) {
    const remaining = pool.get(gram) ?? 0;
    if (remaining > 0) {
      pool.set(gram, remaining - 1);
      shared += 1;
    }
  }

  return (2 * shared) / (left.length + right.length);
}

function bigrams(text: string): string[] {
  const grams: string[] = [];
  for (let index = 0; index < text.length - 1; index += 1) {
    grams.push(text.slice(index, index + 2));
  }
  return grams;
}
