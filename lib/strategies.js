/**
 * lib/strategies.js — autonomous completion strategies.
 *
 * The agent can fully complete forecast bounties on its own: it reads the
 * question, fetches live market data from free public APIs (no key needed),
 * and submits a prediction. Everything else it enters and reports as
 * "needs a build" — it never fakes a code submission.
 *
 * Supported question shapes (matched on title + brief, case-insensitive):
 *   - "<ASSET> close higher tomorrow / up in 24h / up in 7d" (yes/no):
 *     24h momentum signal from CoinGecko; confidence 0.52-0.60 by |move|.
 *   - "predict <ASSET> close / price tomorrow" (number): current spot price.
 *   - anything else forecast-shaped: neutral {answer:"yes",confidence:0.5}
 *     — a valid, honest completion rather than no completion.
 */

const CG_IDS = { btc: "bitcoin", eth: "ethereum", sol: "solana" };
const cache = new Map();

async function cgPrice(id) {
  if (cache.has(id)) return cache.get(id);
  const url =
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}` +
    `&vs_currencies=usd&include_24hr_change=true`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const data = (await res.json())[id];
  const out = { price: data.usd, change24h: data.usd_24h_change };
  cache.set(id, out);
  return out;
}

function detectAsset(text) {
  const t = text.toLowerCase();
  for (const [sym, id] of Object.entries(CG_IDS)) {
    if (t.includes(sym) || t.includes(id)) return { sym, id };
  }
  if (t.includes("spy") || t.includes("s&p")) return { sym: "spy", id: null };
  if (t.includes("gold") || t.includes("xau")) return { sym: "gold", id: null };
  if (t.includes("nvda") || t.includes("nvidia")) return { sym: "nvda", id: null };
  return null;
}

/** Build a prediction for a forecast bounty, or null if not forecast-shaped. */
export async function planPrediction(bounty) {
  if (bounty.cat !== "forecast") return null;
  const text = `${bounty.title} ${bounty.brief || ""}`;
  const asset = detectAsset(text);
  const wantsNumber = /within \$|predict.*(close|price)|what.*(close|price)/i.test(text);
  const isDirection = /higher|up\b|rise|increase|above|yes or no/i.test(text);

  // Numeric close/price target: submit current spot (best naive forecast).
  if (wantsNumber && asset?.id) {
    const { price } = await cgPrice(asset.id);
    return { prediction: { answer: price }, reason: `${asset.sym.toUpperCase()} spot $${price}` };
  }

  // Direction question with a crypto asset: 24h momentum signal.
  if (isDirection && asset?.id) {
    const { change24h } = await cgPrice(asset.id);
    const up = change24h >= 0;
    // Confidence grows with the size of the move, capped: never overconfident.
    const conf = Math.min(0.6, 0.52 + Math.min(Math.abs(change24h), 8) * 0.01);
    return {
      prediction: { answer: up ? "yes" : "no", confidence: +conf.toFixed(2) },
      reason: `${asset.sym.toUpperCase()} 24h ${change24h >= 0 ? "+" : ""}${change24h.toFixed(2)}% -> ${up ? "yes" : "no"} @ ${conf.toFixed(2)}`,
    };
  }

  // Fallback: a valid neutral prediction — honest completion for questions
  // this agent has no signal for.
  return {
    prediction: { answer: "yes", confidence: 0.5 },
    reason: "no market signal available; neutral 0.5",
  };
}
