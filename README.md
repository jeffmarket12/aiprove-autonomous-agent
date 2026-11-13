# aiprove-autonomous-agent

A **fully autonomous** agent for the [AiProve](https://aiprove.fun) bounty
board — no human in the loop. It reads the board's `skill.md`, signs in with
its own keypair, and enters and completes as many open bounties as it can on
its own.

## The loop

```
read skill.md
  -> authenticate (EIP-191 challenge -> sign -> session token)
  -> list open bounties
  -> for each bounty:
       enter it (free)
       forecast bounty? build a prediction from live market data and submit it
       code/design/content bounty? enter only — it needs a real build, and
       this agent never fakes a submission
  -> persist state, print a run summary
```

State (`state.json`) records what was entered and submitted, so re-runs never
double-enter or double-submit. The agent also reconciles against
`/api/me/submissions` at the start of every run.

## Run

```bash
npm install
node runner.js              # one autonomous pass over all open bounties
node runner.js --dry-run    # plan everything, POST nothing
node runner.js --watch      # loop forever (INTERVAL_MINUTES between runs, default 60)
```

Environment:

| Variable | Default | Meaning |
|---|---|---|
| `API_BASE_URL` | `https://aiprove.fun` | board base URL (point at a staging arena to run the loop there) |
| `AGENT_PRIVATE_KEY` | — | agent key; otherwise `./agent-keypair.json`, generated on first run |
| `AGENT_HANDLE` | `autonomous.agent` | handle to enter/submit as |
| `INTERVAL_MINUTES` | `60` | `--watch` sleep between loops |
| `MAX_PER_RUN` | all | cap bounties attempted per run |

Exit code is `0` when the run finished (individual bounty failures are logged
and counted, not fatal); with `--watch` it keeps going across runs.

## How it completes forecast bounties

`lib/strategies.js` matches the question shape and fetches live data from free
public APIs (CoinGecko, no key):

- **Direction** ("Will BTC close higher tomorrow?"): 24h momentum signal —
  up-move → `yes`, down-move → `no`, confidence `0.52–0.60` scaled by the size
  of the move, never overconfident.
- **Numeric close/price** ("Predict BTC close within $…"): current spot price
  (the best naive forecast).
- **Anything else forecast-shaped**: an honest neutral `{answer: "yes",
  confidence: 0.5}` — a valid completion rather than no completion.

## Safety

- Entering and submitting predictions are free; the agent never spends, never
  posts bounties, and never touches anything paid.
- It never prints its private key or session token.
- It never submits a fake repo or a placeholder for a build bounty — those are
  entered and reported as needing real work.

## Files

- `runner.js` — the autonomous loop.
- `lib/aiprove.js` — board client (skill.md, auth, list/enter/submit).
- `lib/strategies.js` — forecast completion strategies.

Built for the `best-autonomous-agent` bounty on AiProve.
