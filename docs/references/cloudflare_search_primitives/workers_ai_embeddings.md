# Workers AI embeddings

Reference for the embedding models available to a Cloudflare Worker, their
limits, costs and response shapes. Written 2026-08-14 while planning search
for this server.

## Models

| Model | Dimensions | Neurons per million input tokens | Cost per million tokens |
|---|---|---|---|
| `@cf/baai/bge-small-en-v1.5` | 384 | 1,841 | $0.020 |
| `@cf/baai/bge-base-en-v1.5` | 768 | 6,058 | $0.067 |
| `@cf/baai/bge-large-en-v1.5` | 1024 | — | — |
| `@cf/baai/bge-m3` | — | — | — |

`bge-m3` is multilingual. The `bge-*-en-v1.5` family is English only.

## Limits

- **Input: 512 tokens** for `bge-base-en-v1.5`. Text above the cap is
  **silently truncated** — no error, no warning, and the tail is simply not
  embedded.
- **Batch: 100 texts** per call. Exceeding it is an error.
- **Rate: 3,000 requests per minute** for text embeddings, except
  `bge-large-en-v1.5`, which is 1,500.

## Pricing and the free allowance

**10,000 neurons per day at no charge**, on both the Free and Paid Workers
plans. The allowance resets daily at **00:00 UTC**. Beyond it, the Workers
Paid plan bills $0.011 per 1,000 neurons.

Worked example for a small store: 3,750 lines is roughly 150,000 tokens. At
`bge-base`'s 6,058 neurons per million tokens, embedding the whole thing costs
about **900 neurons**, or 9% of one day's free allowance.

## Response schema

Taken from `@cloudflare/workers-types`, `Ai_Cf_Baai_Bge_Base_En_V1_5_Output`,
which is authoritative where the prose documentation is silent.

```ts
type Output =
  | { shape?: number[]; data?: number[][]; pooling?: "mean" | "cls" }
  | { request_id?: string };   // async-queue form
```

**There is no usage object.** No `prompt_tokens`, no `total_tokens`, no
neuron count. Text-generation models on Workers AI do report usage, and AI
Gateway logs token counts per request, but the embedding response does not
carry them.

The consequence for anything metering API consumption: token and neuron
figures for embeddings **must be estimated**, and an estimate must be stored
in a column whose name says it is one. The measurable facts are the call
count, the number of texts and their character count.

## Pooling: `mean` and `cls` are not interchangeable

The input accepts `pooling?: "mean" | "cls"`. The type documentation states
that `cls` "will generate more accurate embeddings on larger inputs", that
Cloudflare "highly suggest[s] using the new `cls` pooling for better
accuracy", and — critically — that **"embeddings created with cls pooling are
not compatible with embeddings generated with mean pooling"**.

The default is `mean`, and only because changing it would have been breaking.

This is a silent-failure hazard of the same kind as changing models: cosine
similarity between a `mean` vector and a `cls` vector returns a number, and
the number is meaningless. Anything storing vectors must record the pooling
method alongside the model name, and treat a change in either as invalidating
every stored vector.

## Input forms

Two shapes. The direct form:

```ts
{ text: string | string[], pooling?: "mean" | "cls" }
```

And an async-queue batch form, which returns a `request_id` to collect
results later rather than the vectors themselves:

```ts
{ requests: { text: string | string[], pooling?: "mean" | "cls" }[] }
```

The async form is worth knowing about for large one-off builds. For a store
that embeds in a handful of batched calls, the direct form is simpler and
returns vectors immediately.

## Data handling

Cloudflare states that it does not train models on customer inputs, does not
use them to improve Cloudflare or third-party services "unless we received
your explicit consent", and does not make Customer Content available to other
customers. Cloudflare neither creates nor trains the models offered on Workers
AI. Inputs are stored only if the caller writes them to a storage service.

The documentation describes the models as "Third-Party Services" but does not
state whether inputs reach model providers. For open-weight models such as the
BAAI `bge` family running on Cloudflare's own GPUs there is no provider to
reach, but that is an inference from how the models work, not something the
documentation says.

## Sources

- https://developers.cloudflare.com/workers-ai/models/bge-base-en-v1.5/
- https://developers.cloudflare.com/workers-ai/models/bge-m3/
- https://developers.cloudflare.com/workers-ai/models/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers-ai/platform/limits/
- https://developers.cloudflare.com/workers-ai/platform/data-usage/
- `@cloudflare/workers-types`, `index.d.ts` lines 6672-6714 (response schema)
