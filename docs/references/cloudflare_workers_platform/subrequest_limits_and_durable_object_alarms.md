# Subrequest limits and Durable Object alarms

Reference for why a full index rebuild cannot finish in one `search_memory`
call on the Workers Free plan, and how a Durable Object alarm can carry a
multi-batch rebuild forward without needing repeated search calls to drive
it. Written 2026-08-16 while diagnosing a "Too many subrequests" crash and
designing the fix.

## The subrequest limit

- **Free plan: 50 subrequests per invocation.** **Paid plan: 10,000 by
  default**, configurable up to 10,000,000 via the `limits` field in
  `wrangler.jsonc` — that config field does nothing on Free.
- A subrequest is any request made via the Fetch API, or through a binding to
  a Cloudflare service — D1, KV, R2, Workers AI, Queues. Each hop in a
  redirect chain counts separately.
- No increase path on Free beyond upgrading to Paid, or Cloudflare's "Limit
  Increase Request Form" for exceptional cases.
- Enforced by the runtime terminating the invocation once the count is hit —
  not something application code can catch or negotiate around.

Confirmed directly against this account's Free plan: a Worker handler
looping 60 sequential `fetch()` calls succeeded exactly 50 times, then the
51st threw `Too many subrequests by single Worker invocation`.

## Durable Object alarms get their own separate budget

Not stated explicitly in Cloudflare's docs — confirmed here by direct test,
described below.

- Durable Objects, including alarms, are available on the **Free plan**. The
  one Free-plan restriction is SQLite-backed storage only (not the older
  key-value API) — not a restriction on alarms.
- `state.storage.setAlarm(timestampMs)` schedules a wake-up. One pending
  alarm per object; a second `setAlarm` call replaces the first rather than
  queuing.
- `alarm()` runs automatically when the scheduled time arrives — no incoming
  request needed.
- "Guaranteed at-least-once execution": an uncaught exception retries with
  exponential backoff (2s start), up to 6 attempts, after which the alarm
  goes silent until `setAlarm` is called again. For indefinite retry, catch
  internally and reschedule rather than relying on the built-in ceiling.
- Alarm handlers get their own wall-clock budget, listed separately from a
  normal request's: 15 minutes.
- **The subrequest question, verified by test**: an `alarm()` execution is
  its own invocation with its own fresh subrequest budget, independent of
  whatever request called `setAlarm()`. This is what makes it useful here —
  work too large for one request's 50-subrequest ceiling on Free can still
  complete automatically, one alarm-triggered batch at a time.

### How it was verified

A throwaway Worker (`alarm-subrequest-probe`, deployed and deleted from the
same account this session — not kept in any repo) exposed two paths:

- A plain request handler firing 60 sequential `fetch()` calls. Result:
  `succeeded: 50`, then the standard error — the baseline, confirming the
  test actually exercises the real limit.
- A path that schedules a Durable Object alarm one second out, whose
  `alarm()` handler runs the identical 60-call loop and stores the outcome.
  Result: also `succeeded: 50`, then the same error — independently, not
  `succeeded: 0`. A shared budget would have failed immediately at 0; a full
  fresh run of 50 is direct evidence of a separate invocation with its own
  quota.

## Why this matters here

`FILES_INDEXED_PER_SEARCH` (`src/search_config.ts`) caps a rebuild batch to
12 files per call, sized against Free's 50-subrequest ceiling (roughly 2
subrequests per file: one GitHub blob fetch, one D1 write). The only thing
that currently advances a rebuild past one batch is another `search_memory`
call — nothing schedules the next batch on its own, so an unfinished index
sits wherever it stopped until something happens to search again, and until
then `search_memory` returns results that are correct only over the indexed
portion — indistinguishable to a caller from "not in the store."

A Durable Object alarm set at the end of an incomplete batch — its handler
processing the next batch and rescheduling itself if still incomplete —
lets the index finish on its own across several alarm-driven invocations,
each with a fresh 50-subrequest budget, with no search traffic required.
Works within Free's actual constraints as verified above; does not require
Paid.

## Sources

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/durable-objects/api/alarms/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- Direct test against the `idin@idin.ca` Cloudflare account, 2026-08-16
  (`alarm-subrequest-probe`, deployed and deleted; not kept in any repo).
