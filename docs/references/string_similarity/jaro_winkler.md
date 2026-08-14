# Jaro and Jaro-Winkler

Reference for prefix-weighted string similarity. Written 2026-08-14 while
planning fuzzy search, chosen specifically because errors at the *start* of a
string are rare and this algorithm encodes that.

## Why this rather than edit distance

Levenshtein counts every character difference equally. That is wrong for the
way people actually mistype and misremember: the first letters of a word are
the ones they get right, and the middle and end are where errors land. A
metric treating a wrong first letter the same as a wrong fifth letter is
discarding a strong signal.

Jaro-Winkler is not a tweak on edit distance. It is a different algorithm,
built on the observation that agreement on a prefix is worth more than
agreement elsewhere, and it was designed for name matching for exactly this
reason. It is standard in record linkage, deduplication and name screening.

## Jaro similarity

Two characters are considered **matching** if they are the same and are no
further apart than the matching window:

```
window = floor(max(|s1|, |s2|) / 2) - 1
```

A **transposition** is a pair of matched characters that appear in a different
order in the two strings. The count is the number of such positions divided by
two.

With `m` matching characters and `t` transpositions:

```
jaro = 0 if m = 0, otherwise
       ( m/|s1| + m/|s2| + (m - t)/m ) / 3
```

The three terms are, in order: what fraction of the first string matched, what
fraction of the second matched, and how much of the matching was in the right
order. Note that a metric with no transposition term would call `MARTHA` and
`MARHTA` identical.

Result is in `[0, 1]`, where 1 means identical.

## The Winkler modification

```
jaro_winkler = jaro + (L × p × (1 - jaro))
```

- **`L`** — the length of the common prefix, **capped at 4**.
- **`p`** — the prefix scale factor, standard value **0.1**.

The `(1 - jaro)` term means the bonus is proportional to the remaining
distance from a perfect score, so a bad match cannot be lifted into a good one
by its prefix alone.

**Why `p` is 0.1 and must not exceed 0.25:** with `L` capped at 4, the maximum
bonus multiplier is `L × p = 4p`. At `p = 0.25` that is exactly 1.0, so the
formula becomes `jaro + (1 - jaro)` = 1.0 — every string sharing a four
character prefix scores a perfect match. Above 0.25 the result exceeds 1.0
and stops being a similarity at all. The standard 0.1 is not superstition; it
is the value that leaves the metric well-behaved.

## Worked example

`MARTHA` versus `MARHTA`, the canonical test case:

- Window: `floor(6/2) - 1 = 2`
- All six characters match: `m = 6`
- `T` and `H` are swapped: one transposition pair, `t = 1`
- `jaro = (6/6 + 6/6 + (6-1)/6) / 3 = (1 + 1 + 0.8333) / 3 = 0.9444`
- Common prefix `MAR`, so `L = 3`
- `jaro_winkler = 0.9444 + (3 × 0.1 × (1 - 0.9444)) = 0.9444 + 0.0167 = 0.9611`

Other published vectors useful as tests:

| Pair | Jaro-Winkler |
|---|---|
| `MARTHA` / `MARHTA` | 0.961 |
| `DIXON` / `DICKSONX` | 0.813 |
| `DWAYNE` / `DUANE` | 0.840 |

## Where it misleads

Worth knowing before trusting a score:

- **Short strings produce coarse, high scores.** With three or four
  characters, a single match moves the score a long way, and the prefix bonus
  applies to most of the string. Two unrelated short tokens can score
  surprisingly high.
- **It is not symmetric in usefulness across lengths.** Comparing a short
  query against a long field, the `m/|s2|` term drags the score down even when
  the query appears exactly. This is why substring matching is a separate
  method rather than something fuzzy matching subsumes.
- **The prefix assumption inverts for suffix-differentiated data.** Where
  meaning lives at the end — version numbers, file extensions, numbered
  identifiers — Jaro-Winkler weights precisely the wrong end.
- **It is character-level and word-order blind in the wrong way.** It cannot
  see that `455 Beach Drive` and `Drive, 455 Beach` are the same address; it
  sees two strings whose characters are largely in different places. That
  failure is what token-based methods exist to fix, and why they compose with
  this rather than compete with it.

## Sources

- https://safjan.com/jaro-winkler-similarity/
- https://researchdatapod.com/jaro-winkler-similarity/
- https://moj-analytical-services.github.io/splink/topic_guides/comparisons/comparators.html
- https://www.flagright.com/post/jaro-winkler-vs-levenshtein-choosing-the-right-algorithm-for-aml-screening
- https://rosettacode.org/wiki/Jaro_similarity
