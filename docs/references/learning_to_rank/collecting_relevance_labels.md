# Collecting relevance labels

Reference for turning search results into training data for a ranking model.
Written 2026-08-14 while planning search, where the mechanical layer generates
candidates and an agent judges them.

## The shape

1. **Mechanical retrieval generates candidates** — a pool of N results, each
   carrying every component score that produced it.
2. **A judge reads them** and decides which are relevant. In this system the
   judge is an agent; in classical information retrieval it is a human
   assessor.
3. **Every candidate is recorded** with its feature vector and a label.
4. **The accumulated table trains a model** that maps feature vector to
   relevance, eventually replacing hand-tuned ranking.

The mechanical layer is a *candidate generator*, not the final ranker. This
separation is why the approach works: retrieval optimises for recall, and
ranking optimises for precision over what recall found.

## The rejected candidates are half the signal

A dataset containing only the results that were judged relevant cannot train
anything. A model learns to discriminate by seeing both classes at similar
feature values — what a *bad* match looks like when it scores 0.85 is exactly
the information that makes 0.85 informative.

This is the same principle as recording why options were rejected in a
comparison: the rejections are the expensive, quickly-lost half of the work.

## Three failure modes that quietly ruin the dataset

### Unjudged is not the same as irrelevant

If the judge stops reading at candidate three, candidates four through ten
were **not judged irrelevant** — nobody looked at them.

Recording them as negatives records a guess as a fact, and teaches the model
that low-ranked candidates are bad, which is precisely the prior the model was
supposed to learn or refute from evidence. It bakes the current ranker's
behaviour into the data meant to improve it.

**Unjudged must be a distinct third state**, and it should be the stored
default so that a negative label can only arise from an explicit judgment.

### The features must be regenerable

Store the **query text**, not only the computed feature values.

Feature sets change: a new similarity metric is added, an existing one is
fixed, a chunking change alters what the text even is. If only the numbers
were stored, every historical row is frozen at the feature set that existed
when it was written, and the dataset cannot be extended backwards. Storing the
query and the document identity means every row can be recomputed.

### Labels inherit the retriever's blind spots

A judge only ever sees what retrieval surfaced. If the correct answer never
entered the candidate pool, no label records its absence, and the model
trained on those labels learns the same blind spot.

This is a known ceiling in the approach, sometimes called presentation bias or
pooling bias. The standard mitigation is to occasionally sample beyond the
top-N — deliberately including lower-ranked or randomly chosen candidates in
what gets judged — so the dataset contains evidence about documents the
current ranker does not favour.

Practically: the **candidate pool should exceed the number of results actually
returned**, and the surplus is what counters the bias.

## Whose judgments are they

A relevance judgment is relative to an information need, not to a query
string. Two judges issuing the same words may want different things.

Where multiple agents or users share a table, this is worth recording per row
rather than resolving at collection time — the identity of the judge is a
feature, and whether judgments generalise across judges is a question the data
can answer later. Discarding it makes the question unanswerable.

## Not the same as deciding to use the model

Collecting labels and handing ranking over to a trained model are separate
decisions. Data collection is cheap, reversible and useful on its own — even
unused, it measures how well the mechanical ranker is doing.

Replacing judgment with a model is a change in behaviour that should be
decided explicitly, on evidence from the collected data, rather than following
automatically from having collected it.

## Sources

- Cormack, Clarke and Büttcher, "Reciprocal Rank Fusion outperforms Condorcet
  and individual Rank Learning Methods", SIGIR 2009 —
  https://www.semanticscholar.org/paper/9e698010f9d8fa374e7f49f776af301dd200c548
- https://bigdataboutique.com/blog/reciprocal-rank-fusion-how-it-works-and-when-to-use-it
