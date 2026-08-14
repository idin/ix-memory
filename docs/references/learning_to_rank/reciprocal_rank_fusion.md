# Reciprocal Rank Fusion

Reference for combining results from multiple retrievers into one ranking.
Written 2026-08-14 while planning hybrid search, where a lexical matcher and
an embedding matcher each produce a ranked list and something has to merge
them.

## The problem: scores from different retrievers are not comparable

The obvious approach — normalise each score to `[0, 1]` and take a weighted
sum — is wrong, and wrong in a way that produces plausible-looking rankings.

Two retrievers can both emit numbers in `[0, 1]` while those numbers mean
entirely different things:

- **Jaro-Winkler** spans its range properly. An exact match is a hard 1.0, and
  unrelated strings score low.
- **Cosine similarity over sentence embeddings** does not. Embedding spaces
  are anisotropic: any two English sentences, however unrelated, tend to score
  somewhere around 0.6 to 1.0. A cosine of 0.72 may mean "nothing in common".

Under `0.5 × jaro + 0.5 × cosine`, an irrelevant chunk scoring 0.72 by cosine
outranks a genuine lexical near-miss scoring 0.85. The failure is silent: the
ranking looks reasonable and is wrong.

Normalising per query does not fix it either, since it rescales noise into the
full range whenever a retriever finds nothing good.

## The method

**Reciprocal Rank Fusion** discards the scores and uses only the ranks:

```
score(d) = Σ over retrievers  1 / (k + rank_i(d))
```

where `rank_i(d)` is document `d`'s position in retriever `i`'s list, counting
from 1, and `k` is a smoothing constant.

Because it consumes only ordinal positions, incommensurate score scales are
**structurally impossible to mix wrongly**. A retriever whose scores are all
0.9 and one whose scores are all 0.02 contribute identically if they rank the
same documents in the same order.

It also has **no per-retriever weights to tune**, which matters when there is
no labelled data yet to tune them with. Weights are a decision deferred until
there is evidence, rather than invented at design time.

## The `k` constant

`k = 60` in the original paper, found empirically on TREC data.

Its purpose is to damp the dominance of the top rank. Without it — at `k = 0`
— rank 1 contributes 1.0 and rank 2 contributes 0.5, so a single retriever's
top hit can never be displaced by agreement further down. With `k = 60`, rank
1 contributes 1/61 and rank 2 contributes 1/62: close enough that several
retrievers agreeing at rank 3 can outrank one retriever's rank 1.

Later benchmarks find anything in roughly `[40, 80]` performs comparably, and
most implementations picked 60 for that reason.

## Provenance and adoption

Introduced by Cormack, Clarke and Büttcher, *"Reciprocal Rank Fusion
outperforms Condorcet and individual Rank Learning Methods"*, SIGIR 2009.

It is the default hybrid-search fusion in Elasticsearch, OpenSearch, Azure AI
Search, MongoDB Atlas, Weaviate and Apache Doris — typically merging a BM25
keyword ranker with a dense vector ranker, which is the same shape as merging
a lexical matcher with an embedding matcher.

## What it does not do

Worth being clear about, since RRF is sometimes treated as a complete answer:

- **It discards magnitude.** A retriever that is certain and a retriever that
  is guessing contribute equally at the same rank. Where one retriever's
  confidence is genuinely meaningful, that information is thrown away.
- **It cannot rescue a bad candidate set.** If neither retriever surfaces the
  right document, fusion cannot invent it. Recall is decided upstream.
- **It treats all retrievers as equally trustworthy.** This is a feature
  before there is evidence, and a limitation after. Weighted variants exist,
  but weights should come from labelled data rather than intuition.
- **Ties are common.** Documents found by exactly one retriever at the same
  rank score identically, so a secondary ordering is needed for stability.

## Keeping the component scores

RRF decides the *ordering*, but the individual scores should still be carried
through to the result rather than discarded.

Two reasons. A result an agent cannot explain is one it will misuse, so each
hit should say what matched and how. And any future ranking model trains on
the full feature vector — every component score — so throwing the scores away
at fusion time destroys the training data before it is collected.

## Sources

- https://www.semanticscholar.org/paper/Reciprocal-rank-fusion-outperforms-condorcet-and-Cormack-Clarke/9e698010f9d8fa374e7f49f776af301dd200c548
- https://bigdataboutique.com/blog/reciprocal-rank-fusion-how-it-works-and-when-to-use-it
- https://doris.apache.org/docs/dev/key-features/reciprocal-rank-fusion/
- https://blog.serghei.pl/posts/reciprocal-rank-fusion-explained/
