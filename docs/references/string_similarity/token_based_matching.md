# Token-based string matching

Reference for comparing multi-word strings without treating them as one long
character sequence. Written 2026-08-14; the companion to
[jaro_winkler.md](jaro_winkler.md), which handles the within-word half of the
same problem.

## The problem character-level metrics cannot solve

`455 Beach Drive` and `Drive, 455 Beach` are the same address. Every
character-level metric scores them poorly, because the characters are in
different places, and a character-level metric has no concept of a word as a
unit that can move.

This is not a tuning problem. No threshold on Jaro-Winkler or Levenshtein
fixes it, because the information those metrics operate on — character
positions — is exactly the information that word reordering destroys.

The fix is to tokenize first, then compare tokens. Word order becomes
something the comparison can normalise away rather than something it
mistakes for dissimilarity.

## The methods

Named after their `rapidfuzz` / `fuzzywuzzy` implementations, which are the
de facto standard names.

### `ratio`

The baseline: normalised Indel (insertion-deletion) similarity over the whole
string, scored 0-100. This is the character-level comparison the others build
on.

### `partial_ratio`

Finds the best alignment of the shorter string inside the longer one and
returns the `ratio` for that alignment. Useful when a short query should match
a fragment of a long field.

Implementation note: for needles up to 64 characters it checks all alignments
in O(NM); for longer needles it only examines alignments beginning at longest
common substrings.

### `token_sort_ratio`

**Sorts the tokens alphabetically in both strings, then compares.** Word order
stops mattering entirely.

This is what solves the address case: both strings sort to the same token
sequence, and the score approaches 100.

### `token_set_ratio`

**Compares the sets of tokens**, using the intersection and the two
differences rather than the raw sequences. Duplicate words stop mattering, and
large differences in length are tolerated.

The documented behaviour worth remembering: it **returns 100 if one string is
a subset of the other**, and only reduces the score when there is explicit
disagreement between tokens.

The canonical contrast:

| Pair | `token_sort_ratio` | `token_set_ratio` |
|---|---|---|
| `fuzzy was a bear` / `fuzzy fuzzy was a bear` | 83.87 | 100.0 |

### `WRatio`

A weighted combination of the others. Convenient, but it hides which method
produced the score — which matters when a result has to explain itself.

## Choosing between sort and set

They fail in opposite directions, so the choice is not arbitrary:

- **`token_sort_ratio`** keeps duplicates and length differences significant.
  Prefer it when the two strings should be roughly the same *content*, merely
  reordered.
- **`token_set_ratio`** ignores both. Prefer it when one string may legitimately
  be much longer, or contain the other.

**Where `token_set_ratio` misleads:** because a subset scores 100, a
two-word query matching two words of a forty-word chunk scores perfectly. In a
search index where fields vary wildly in length, that produces confident false
positives. It is the more forgiving metric, and forgiveness is not always what
retrieval wants.

**Where `token_sort_ratio` misleads:** the sort is alphabetical, not semantic,
so it will equate strings whose meaning depends on order. `dog bites man` and
`man bites dog` sort identically.

## Composing with prefix weighting

The two families address different halves of the problem and compose rather
than compete:

1. **Tokenize** both strings — word order is now a property of the sequence,
   not of the characters.
2. **Compare token to token** with a prefix-weighted metric such as
   Jaro-Winkler, so within each word the first letters count for more.
3. **Aggregate** the per-token scores — typically best-match alignment between
   the two token lists.

The result has both properties at once: word order does not matter, and within
each word a wrong first letter costs more than a wrong fifth letter. This is
standard practice in record linkage, which is the same problem as retrieval —
matching a messy query against clean stored records.

## Implementation note

`rapidfuzz` is a C++ extension module for Python. It is not importable in a
JavaScript runtime, and not importable on Cloudflare Python Workers either,
which cannot load arbitrary compiled wheels.

Its value is speed over millions of comparisons. The algorithms themselves are
small — Jaro-Winkler is roughly forty lines, and the token ratios are a
tokenize plus a sort or a set operation on top of a ratio function. For
comparisons in the thousands rather than the millions, implementing them
directly is cheaper than adding a runtime.

## Sources

- https://rapidfuzz.github.io/RapidFuzz/Usage/fuzz.html
- https://github.com/rapidfuzz/RapidFuzz
- https://www.datacamp.com/tutorial/fuzzy-string-python
- https://medium.com/@kasperjuunge/rapidfuzz-explained-c26e93b6012d
