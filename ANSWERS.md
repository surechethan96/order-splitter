# Answers

## 1. What was my approach?

I started with the example from the brief $100 going into AAPL at 60% and TSLA at 40% and built out from there.

First I wrote down everything in the brief that wasn't clear. It's open-ended on purpose, so instead of guessing silently I listed each gap and picked the simplest answer a real partner could actually live with. All of that ended up in section 2.

Once I knew what I was building, I designed the API before writing much code. It's one resource, `orders`. You `POST` to create a split (which also saves it) and `GET` to read the history back. Plain REST, nothing clever, easy to explain in a review.

The actual maths lives on its own in `order-splitter.ts` as a single pure function with no NestJS in it. That's the part that has to be correct, and keeping it framework-free made it trivial to test in isolation.

Anything the brief hinted might change later, quantity decimals, the fixed price, market hours, holidays, I pushed into environment variables. So going from 3 decimals to 7 is a config change, not a code change.

On top of that I added the production bits that are actually worth having in a proof of concept and nothing more: validation, a single error shape, request timing, idempotency, and a health check. I wrote tests as I went, unit tests for the maths and the market calendar, end-to-end tests for the HTTP side, and then spent a while deliberately throwing bad input at my own API and fixing anything that came back as a 500.

Last thing I added was a small console page so someone can try it without touching curl. It's just HTML and JS, no build step.

The whole time I was trying not to over-engineer. No database, no CQRS, no event bus. If a class didn't make the code easier to read, it didn't go in.

## 2. What assumptions did I make?

### Input

| # | Assumption | Reasoning |
| --- | --- | --- |
| 1 | Weights are percentages and have to add up to exactly 100. Each one is between 0.01 and 100, up to 2 decimals. | A portfolio that sums to 90 or 110 is almost certainly a mistake, and I'd rather reject it than quietly guess what was meant. |
| 2 | `totalAmount` is in USD, from 0.01 up to 10,000,000, 2 decimals. | The brief is in USD. The cap is just there to catch fat-finger errors. |
| 3 | For a SELL, `totalAmount` is the dollar value to sell, split by the same weights. I don't check what the user actually holds. | The brief treats "amount to be purchased/sold" as a single input, and holdings aren't part of this POC. |
| 4 | Price is per stock and optional, 0.01 to 1,000,000, up to 4 decimals. If the partner sends it, it wins; if it's missing or null, the fixed $100 kicks in. A single request can mix both. | The brief says the partner price "should take priority", and per-stock is the most flexible way to read that. |
| 5 | "Price at time of purchase" means the price in the request. There's no live feed. | The brief fixes the price to keep things simple. |
| 6 | A symbol can only show up once. Symbols are 1–10 characters, stored upper case. | Two lines for the same stock is ambiguous. I don't verify the symbol actually exists. |
| 7 | A portfolio has between 1 and 100 stocks. | Keeps requests small and predictable. |
| 8 | Numbers have to be real JSON numbers, and unknown fields get rejected, including `__proto__`, `constructor` and `prototype`. | A strict contract surfaces partner bugs early. `"100"` as a string is treated as a mistake, not coerced. Those three keys get the same 400 as any other unknown field. |
| 9 | Request bodies can be up to 100 KB and 10 levels deep. | 100 stocks fit several times over; anything bigger gets a 413. A real order is about 4 levels deep, and much deeper bodies would crash the validator, so they get a 400. |

### Calculation

| # | Assumption | Reasoning |
| --- | --- | --- |
| 10 | Share quantities are always rounded down, never up. Each stock's `amount` (quantity x price) is also rounded down to the cent. | Rounding up could buy/sell more than asked, or show more than is really traded (99.99 x $3.3333 = $333.2967 shows as $333.29, not $333.30). The leftover shows up as `unallocatedAmount`, and allocated + unallocated always equals the total. |
| 11 | Money is split in whole cents, and the parts always add back up to the total. | Avoids the classic "lost cent" problem. I used the largest-remainder method. |
| 12 | Leftover money doesn't get shuffled into another stock. | Moving it would quietly change the weights the partner asked for. |
| 13 | If a stock rounds to 0 shares it's still returned with quantity 0. If *every* stock rounds to 0, the whole request is rejected with a 422. | The partner can ignore a zero line, but an order with nothing to trade isn't useful. |
| 14 | BUY and SELL follow the same rules, rounding down included. | Selling slightly fewer shares than the target is safer than selling more. |
| 15 | Quantity decimals can be 0–8 and apply to every stock. | The brief mentions 3 now and maybe 7 later. One global value is the simplest reading. |
| 16 | A quantity needing more than 15 digits is rejected with a 422. | A JSON number can't hold that exactly. It only comes up with extreme amounts at tiny prices. |

### When to execute

| # | Assumption | Reasoning |
| --- | --- | --- |
| 17 | Market hours are Mon–Fri, 09:30 to 16:00 New York time. | The brief only says Monday to Friday, but "when" needs an actual time, so I added US hours. Both are configurable. |
| 18 | Holidays are a list in the settings, empty by default, no half days. | The brief doesn't mention them, but a real calendar needs them, so the hook is there. |
| 19 | Market open → execute now. Market closed → execute at the next open. | Simple and predictable. The response gives the time in both UTC and market time. |
| 20 | An order placed just before the close still says "execute now". | The partner is the one placing the trade, so they own the cut-off. |
| 21 | The market opens and closes on the same day, no overnight sessions. | Not needed for US stocks. |

### Storage and behaviour

| # | Assumption | Reasoning |
| --- | --- | --- |
| 22 | A `POST` records an order plan. It doesn't place a trade. | The brief says the partner would place the orders themselves. |
| 23 | History is everything created since the app started, newest first, with paging. Capped at 10,000, then the oldest drop off. | "Data shouldn't survive a restart" means in-memory, and the cap stops memory growing forever. |
| 24 | Rejected requests aren't stored. | History should only ever show valid plans. |
| 25 | One partner, one running instance. No accounts or tenants. | It's a POC, idempotency keys live in memory. |
| 26 | `Idempotency-Key` is optional. Same key + same body returns the original order; same key with a different body (including the same stocks in a different order) gives a 409. Keys are kept apart from the history (up to 100,000), so if the order has already dropped out of the 10,000-order history, a late retry also gets a 409 instead of a duplicate. After a restart, keys are gone. | Retries are safe when the partner wants them, without forcing the header on everyone. When we can no longer return the order, refusing is safer than creating it twice. |
| 27 | No authentication and no rate limiting. | Both are production concerns, left out to keep the POC lean. See section 4. |
| 28 | Settings are read once at startup; changing them needs a restart. | Fine for "internally configurable". |
| 29 | "Response time visible in the console" = one log line per request with the time in ms. | Easiest thing to read while testing. |

## 3. What challenges did I face?

The ambiguity was the first one. "When should orders be executed" and "amount to be sold" can each be read a few different ways, so I just picked a reading, wrote it down, and turned it into a setting wherever that was cheap to do.

Floating point bit me early. `0.1 + 0.2` isn't `0.3` in JavaScript, so weights like 0.1, 0.2 and 99.7 failed a naive "do these add up to 100" check even though they clearly do. I moved all the arithmetic over to `decimal.js`.

Rounding was the fiddly one. Splitting $0.05 three ways gives you 33.33 / 33.33 / 33.34, i.e. fractions of a cent. The largest-remainder method hands out 2, 1 and 2 cents, which actually adds back to 5. I wrote a test that throws 300 random portfolios at it to confirm the parts always equal the total and never go over.

Time zones were another. The server can run anywhere, but market hours are New York time, and daylight saving shifts the open from 14:30 to 13:30 UTC. I used `luxon` and added a test around the weekend the clocks change.

The most interesting part was attacking my own API. Sending it deliberately broken input turned up three real bugs that all returned 500s:
- A number written as `1e-7` blew up the decimal-places check inside `class-validator`, so I swapped that for my own check built on `decimal.js`.
- A list nested inside the portfolio list (`[[{...}]]`) slipped past validation and failed later, now each item has to be an object.
- A body over 100 KB came back as a 500 instead of a 413; the error filter now preserves the 4xx that Express raises.

A couple of smaller ones: `class-validator` runs its decorators bottom-up, so my first version answered a *missing* amount with "must not be greater than 10000000". I reordered the decorators and stop at the first failure, so each field reports its most basic problem first. And on precision, with 8 decimals and a huge amount at a tiny price, a quantity can need 17 digits, but a JSON number only holds 15, so I reject that rather than return something slightly wrong.

There was also a dependency snag: the newest `@nestjs/swagger` wants NestJS 12, but I'm on 11, so I pinned Swagger to 11.


## 4. What would I change for production?

**Security**

- Partner authentication. An API key per partner is a quick first step (I had a simple `x-api-key` check in an earlier version and took it out to keep the POC lean). The real answer is OAuth 2.0 client credentials or mutual TLS, one identity per partner, with scopes.
- Every order tied to a partner, and filtered by partner on every read.
- TLS everywhere, secrets in a secrets manager, strict CORS.
- An audit log of who created what and when, plus dependency and image scanning in the pipeline.
- Rate limiting per partner, counted off the real client address behind the load balancer, for example `@nestjs/throttler` with Redis storage. I had it in an earlier version and took it out to keep the POC lean.

**Data**

- PostgreSQL instead of memory, the repository class is the only file that would change.
- Idempotency keys stored in the DB with a time-based expiry (for example 24 hours) and a unique index, so two parallel retries on different instances can't both win, and a restart doesn't forget them.
- Cursor paging for history instead of offset.
- Money and quantities sent as strings (or integers in the smallest unit) so nothing is ever capped by JSON number precision.

**Trading rules**

- A real market calendar from a data provider, with half days. Right now holidays are a manual list.
- Live or validated prices, a rule for stale ones, and a check that the symbol exists.
- For SELL, actually check the user's holdings, and add minimum order sizes per stock.
- A decision with the partner on leftover cash, keep it, or give it to the largest holding.
- Quantity decimals per stock or per partner, not one global value.
- A cut-off before the close, so an order at 15:59:59 rolls to the next day.

**Reliability and scale**

- More than one instance behind a load balancer, which needs the shared DB above plus a shared rate limiter (Redis).
- If we ever execute orders ourselves, accept the request, drop it on a queue (Kafka or SQS) and process with workers, to survive bursts like the market open.
- Timeouts, retries with backoff, and circuit breakers on every outside call.

**Operations**

- Structured JSON logs, metrics (request rate, errors, p95/p99 latency), tracing, dashboards and alerts.
- Readiness and liveness probes, graceful shutdown, autoscaling.
- CI/CD with lint, tests, a coverage gate, image build and staged rollout, there's a basic CI workflow in the repo already.
- Load tests before launch, and API versioning with a deprecation policy for partners.

For what it's worth, a fair bit of production thinking is already in here. The strict validation means bad data never reaches the business logic or causes a 500. There's a single error shape with a request id so partners handle errors one way and I can trace any call. `Idempotency-Key` stops a network retry creating a duplicate, even after the order has dropped out of history. The decimal maths and precision guard mean no rounding surprises with money or shares. Config is validated at startup, so a bad setting stops the deploy instead of producing wrong results later. Market hours and holidays are configurable without touching code. There's a 100 KB body cap and a nesting limit so one request can't swamp the service, `helmet` for the browser-facing pages, a health endpoint for load balancers / k8s, a memory cap on stored orders, a request log in milliseconds (including aborted requests), URI versioning (`/api/v1`), and a Dockerfile plus CI workflow.

## 5. How did I use LLMs?

I used Claude as a pair programmer.It wrote the first drafts of the code, tests and docs, and I reviewed them the way I'd review a colleague's PR. Nothing went in unless the tests, linter and type checker passed.

**Where it helped**

- **Finding the open questions.** It turned the brief into the list in section 2. For example, it pointed out that "when to execute" needs a time zone and opening hours, not just "Monday to Friday".
- **The money maths.** It suggested the largest-remainder method for splitting cents, and rounding quantities down. The $0.05 across three stocks test came from that.
- **Edge-case tests.** It proposed the daylight-saving test (Friday 6 March to Monday 9 March 2026, when the open moves from 14:30 to 13:30 UTC) and the test with 300 random portfolios.
- **Attacking the API.** It sent awkward requests to the running server. Three came back as 500s (`1e-7`, a list inside the portfolio list, a body over 100 KB). Each one got a fix and a test.

**Where it got things wrong, and how it was caught**

- **Line amounts rounded up.** It rounded each stock's `amount` half-up, so 99.99 shares x $3.3333 = $333.2967 showed as $333.30, more than is really traded. When I asked it to review the code, it checked that `unallocatedAmount` can never go negative and called the rounding safe, so it missed this. Caught in code review. Fix: round the amount down, with a test for that exact case and a check over 300 random portfolios that no amount is ever more than quantity x price.
- **Idempotency keys dropped with old orders.** When the 10,000-order cap was hit, it deleted the order and its key together, so a late retry could create a duplicate. Caught in code review. Keys are now kept apart from the history, and a late retry gets a 409 instead of a new order.
- **A test that hid a bug.** Its test for a body with `__proto__` accepted either a 201 or a 400. That let `__proto__` and `constructor` slip past the unknown-field check without anyone noticing. Caught in code review. They are now rejected with a 400, and the test expects exactly that. While fixing this we also found that a body nested thousands of levels deep crashed the validator with a 500. It now gets a 400.
- **Validation messages.** Its first version answered a *missing* amount with "must not be greater than 10000000", because `class-validator` runs decorators bottom-up. Spotted by running the API, fixed by reordering the decorators and stopping at the first failure.
- **Library versions.** It installed the newest `@nestjs/swagger`, which needs NestJS 12, on a NestJS 11 project. The install failed, and we pinned Swagger to 11.
