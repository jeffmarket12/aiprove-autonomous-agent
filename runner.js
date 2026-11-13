#!/usr/bin/env node
/**
 * runner.js — fully autonomous AiProve agent.
 *
 * Loop (no human in the loop):
 *   1. read skill.md from the board
 *   2. authenticate with the agent's own keypair (EIP-191 challenge -> sign)
 *   3. list open bounties
 *   4. for each open bounty:
 *        - enter it (free)
 *        - if it is a forecast bounty, build a prediction from live market
 *          data (see lib/strategies.js) and submit it
 *        - otherwise log it as "entered, needs a build" (code/design/content
 *          bounties need real work — the agent never fakes a submission)
 *   5. persist state (state.json) so re-runs never double-enter or
 *      double-submit; print a run summary
 *
 * Env:
 *   API_BASE_URL      board base URL (default https://aiprove.fun)
 *   AGENT_PRIVATE_KEY agent key; else ./agent-keypair.json (generated on
 *                     first run) — the agent's own identity
 *   AGENT_HANDLE      handle to enter/submit as (default "autonomous.agent")
 *   INTERVAL_MINUTES  with --watch, minutes between loops (default 60)
 *   MAX_PER_RUN       cap on bounties attempted per run (default: all)
 *
 * Flags:
 *   --dry-run   plan everything, POST nothing
 *   --watch     loop forever, sleeping INTERVAL_MINUTES between runs
 *   --once      single run (default)
 */
import fs from "node:fs";
import path from "node:path";
import { API, Board, loadWallet, readSkill } from "./lib/aiprove.js";
import { planPrediction } from "./lib/strategies.js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const WATCH = args.includes("--watch");
const HANDLE = process.env.AGENT_HANDLE || "autonomous.agent";
const STATE_FILE = path.resolve(process.env.STATE_FILE || "./state.json");
const INTERVAL_MS = (Number(process.env.INTERVAL_MINUTES) || 60) * 60 * 1000;
const MAX_PER_RUN = Number(process.env.MAX_PER_RUN) || Infinity;

const log = (tag, msg) => console.log(`[${tag}] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { entered: {}, submitted: {} };
  }
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function runOnce() {
  const started = Date.now();
  const summary = { entered: 0, submitted: 0, skipped: 0, failed: 0 };
  const state = loadState();

  // 1. Read the board's instructions.
  const skill = await readSkill();
  log("skill.md", `read ${skill.length} chars from ${API}/skill.md`);

  // 2. Authenticate with the agent's own keypair.
  const wallet = loadWallet();
  const board = new Board(wallet);
  await board.authenticate();
  log("auth", `signed in as ${wallet.address}`);

  // 3. List open bounties (+ reconcile with what we already submitted).
  const open = await board.listOpen();
  const mine = await board.mySubmissions().catch(() => []);
  for (const s of mine) state.submitted[s.bountySlug] = s.id;
  if (!DRY_RUN) saveState(state);
  log("bounties", `${open.length} open, ${mine.length} already submitted by this agent`);

  // 4. Work each open bounty.
  for (const bounty of open.slice(0, MAX_PER_RUN)) {
    const tag = bounty.slug;
    try {
      if (state.submitted[bounty.slug]) {
        log(tag, "already submitted; skipping");
        summary.skipped++;
        continue;
      }
      if (!state.entered[bounty.slug]) {
        if (DRY_RUN) {
          log(tag, "dry run: would enter");
        } else {
          await board.enter(bounty.slug, HANDLE);
          log(tag, `entered (${bounty.amt ?? ""} ${bounty.unit ?? ""} ${bounty.cat}/${bounty.lane})`);
          state.entered[bounty.slug] = Date.now();
          summary.entered++;
        }
      }
      const plan = await planPrediction(bounty);
      if (!plan) {
        log(tag, `entered only — ${bounty.cat} bounty needs a real build; not faking a submission`);
        summary.skipped++;
        continue;
      }
      if (DRY_RUN) {
        log(tag, `dry run: would submit prediction ${JSON.stringify(plan.prediction)} (${plan.reason})`);
      } else {
        const sub = await board.submitPrediction(bounty.slug, plan.prediction, HANDLE);
        state.submitted[bounty.slug] = sub.id;
        log(tag, `submitted prediction ${JSON.stringify(plan.prediction)} (${plan.reason}) -> ${sub.id} [${sub.status}]`);
        summary.submitted++;
      }
    } catch (e) {
      log(tag, `FAILED: ${e.message.slice(0, 200)}`);
      summary.failed++;
    }
    if (!DRY_RUN) saveState(state);
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `\nRUN COMPLETE in ${secs}s: entered=${summary.entered} submitted=${summary.submitted} skipped=${summary.skipped} failed=${summary.failed}`
  );
  return summary;
}

async function main() {
  console.log(`aiprove-autonomous-agent starting (dryRun=${DRY_RUN}, watch=${WATCH}, handle=${HANDLE})`);
  for (;;) {
    try {
      await runOnce();
    } catch (e) {
      console.error(`[fatal] run failed: ${e.message}`);
      if (!WATCH) process.exit(1);
    }
    if (!WATCH) break;
    log("watch", `sleeping ${INTERVAL_MS / 60000} min until next loop`);
    await sleep(INTERVAL_MS);
  }
}

main();
