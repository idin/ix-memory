/**
 * String similarity metrics.
 *
 * Two properties are wanted, and no single metric provides both.
 *
 * The first letters of a word matter more than the rest, because dropping a
 * first letter is rare — people get the start right and go wrong in the middle
 * or at the end. Jaro-Winkler encodes exactly this, and is a separate
 * algorithm rather than a tweak on edit distance.
 *
 * Sentences are not long strings. "455 Beach Drive" and "Drive, 455 Beach" are
 * the same address and far apart under any character-level metric, because
 * character position is precisely what word reordering destroys. The fix is to
 * tokenize first and compare tokens.
 *
 * The two compose: tokenize, compare token to token with prefix weighting,
 * aggregate. Word order stops mattering, and within each word the first
 * letters count for more.
 *
 * Implemented here rather than pulled in: rapidfuzz is a C++ extension, not
 * importable in a Worker or on Cloudflare Python Workers, and its value is
 * speed over millions of comparisons rather than correctness. These are small
 * algorithms with published test vectors.
 *
 * See docs/references/string_similarity/.
 */

/**
 * How many leading characters can earn the prefix bonus.
 *
 * Winkler's cap. This is the constant that encodes "first letters matter
 * more": agreement beyond the fourth character stops earning extra credit,
 * so the bonus rewards getting the start right rather than being long.
 */
const JARO_WINKLER_MAXIMUM_PREFIX = 4;

/**
 * How much each matching prefix character is worth.
 *
 * Standard value, and the reason it is standard is arithmetic rather than
 * convention: the maximum bonus multiplier is prefix length times this, so at
 * 0.25 with a cap of 4 the formula returns exactly 1.0 for any pair sharing
 * four leading characters, and above 0.25 it exceeds 1.0 and stops being a
 * similarity at all. 0.1 leaves the metric well-behaved.
 */
const JARO_WINKLER_PREFIX_SCALE = 0.1;

/**
 * Jaro similarity.
 *
 * Two characters match if they are equal and no further apart than half the
 * longer string's length, minus one. A transposition is a matched pair
 * appearing in a different order in each string; without that term, "MARTHA"
 * and "MARHTA" would score identically to a perfect match.
 *
 * @param first - One string.
 * @param second - The other.
 * @returns Similarity in [0, 1], where 1 is identical.
 */
export function jaroSimilarity(first: string, second: string): number {
  if (first === second) {
    return 1;
  }
  if (first.length === 0 || second.length === 0) {
    return 0;
  }

  const window = Math.max(
    0,
    Math.floor(Math.max(first.length, second.length) / 2) - 1,
  );
  const firstMatched = new Array<boolean>(first.length).fill(false);
  const secondMatched = new Array<boolean>(second.length).fill(false);
  let matches = 0;

  for (let index = 0; index < first.length; index += 1) {
    const start = Math.max(0, index - window);
    const end = Math.min(index + window + 1, second.length);
    for (let other = start; other < end; other += 1) {
      if (secondMatched[other] || first[index] !== second[other]) {
        continue;
      }
      firstMatched[index] = true;
      secondMatched[other] = true;
      matches += 1;
      break;
    }
  }

  if (matches === 0) {
    return 0;
  }

  let transpositions = 0;
  let secondIndex = 0;
  for (let index = 0; index < first.length; index += 1) {
    if (!firstMatched[index]) {
      continue;
    }
    while (!secondMatched[secondIndex]) {
      secondIndex += 1;
    }
    if (first[index] !== second[secondIndex]) {
      transpositions += 1;
    }
    secondIndex += 1;
  }

  const halfTranspositions = transpositions / 2;
  return (
    (matches / first.length
      + matches / second.length
      + (matches - halfTranspositions) / matches)
    / 3
  );
}

/**
 * Jaro-Winkler similarity: Jaro plus a bonus for a shared prefix.
 *
 * The bonus is proportional to the remaining distance from a perfect score,
 * so a poor match cannot be lifted into a good one by its prefix alone.
 *
 * @param first - One string.
 * @param second - The other.
 * @returns Similarity in [0, 1].
 */
export function jaroWinklerSimilarity(
  first: string,
  second: string,
): number {
  const jaro = jaroSimilarity(first, second);
  let prefix = 0;
  const longest = Math.min(
    JARO_WINKLER_MAXIMUM_PREFIX,
    first.length,
    second.length,
  );
  while (prefix < longest && first[prefix] === second[prefix]) {
    prefix += 1;
  }
  return jaro + prefix * JARO_WINKLER_PREFIX_SCALE * (1 - jaro);
}

/**
 * Split text into comparable tokens.
 *
 * Lowercased and stripped of punctuation, so "Drive," and "drive" are the same
 * token. Diacritics are folded, so a query typed without accents still reaches
 * text that has them.
 *
 * @param text - The text to split.
 * @returns Its tokens, in order, with empties dropped.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/** Similarity between two token lists compared as ordered sequences. */
function sequenceSimilarity(first: string[], second: string[]): number {
  return jaroWinklerSimilarity(first.join(" "), second.join(" "));
}

/**
 * Compare two strings with word order removed.
 *
 * Sorts both token lists before comparing, so "455 Beach Drive" and
 * "Drive, 455 Beach" become the same sequence. Duplicates and length
 * differences still count.
 *
 * @param query - What was searched for.
 * @param field - What is being searched.
 * @returns Similarity in [0, 1].
 */
export function tokenSortRatio(query: string, field: string): number {
  return sequenceSimilarity(
    [...tokenize(query)].sort(),
    [...tokenize(field)].sort(),
  );
}

/**
 * Compare two strings as sets of words.
 *
 * Ignores duplicates and tolerates one string being much longer, by comparing
 * the shared tokens against each side's extras.
 *
 * The documented behaviour worth remembering: a string that is a subset of the
 * other scores 1. That is forgiving, and forgiveness is not always what
 * retrieval wants — a two-word query matching two words of a forty-word chunk
 * scores perfectly. It is paired with the sort ratio for that reason.
 *
 * @param query - What was searched for.
 * @param field - What is being searched.
 * @returns Similarity in [0, 1].
 */
export function tokenSetRatio(query: string, field: string): number {
  const queryTokens = new Set(tokenize(query));
  const fieldTokens = new Set(tokenize(field));
  if (queryTokens.size === 0 || fieldTokens.size === 0) {
    return 0;
  }

  const shared = [...queryTokens].filter((token) => fieldTokens.has(token));
  const queryOnly = [...queryTokens].filter((token) => !fieldTokens.has(token));
  const fieldOnly = [...fieldTokens].filter((token) => !queryTokens.has(token));

  const sharedText = shared.sort().join(" ");
  const withQueryExtras = [sharedText, ...queryOnly.sort()]
    .join(" ")
    .trim();
  const withFieldExtras = [sharedText, ...fieldOnly.sort()].join(" ").trim();

  return Math.max(
    jaroWinklerSimilarity(sharedText, withQueryExtras),
    jaroWinklerSimilarity(sharedText, withFieldExtras),
    jaroWinklerSimilarity(withQueryExtras, withFieldExtras),
  );
}

/**
 * Score a query against a field, token by token, prefix-weighted.
 *
 * This is the composition the two objections call for: every query token finds
 * its best match among the field's tokens, and the per-token comparison is
 * prefix-weighted. Word order is irrelevant because each token is matched
 * independently; within each token, the first letters count for more.
 *
 * Averaging over query tokens rather than field tokens is deliberate — the
 * field is usually far longer, and dividing by its length would drive every
 * score towards zero for any chunk of real size.
 *
 * @param query - What was searched for.
 * @param field - What is being searched.
 * @returns Similarity in [0, 1].
 */
export function bestTokenAlignment(query: string, field: string): number {
  const queryTokens = tokenize(query);
  const fieldTokens = tokenize(field);
  if (queryTokens.length === 0 || fieldTokens.length === 0) {
    return 0;
  }

  let total = 0;
  for (const queryToken of queryTokens) {
    let best = 0;
    for (const fieldToken of fieldTokens) {
      const score = jaroWinklerSimilarity(queryToken, fieldToken);
      if (score > best) {
        best = score;
      }
      if (best === 1) {
        break;
      }
    }
    total += best;
  }
  return total / queryTokens.length;
}
