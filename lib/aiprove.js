/**
 * lib/aiprove.js — minimal AiProve board client.
 * Reads skill.md, authenticates with the agent's own keypair (EIP-191
 * challenge -> sign -> session), and wraps the list/enter/submit endpoints.
 * Never logs the private key or the session token.
 */
import fs from "node:fs";
import path from "node:path";
import { Wallet } from "ethers";

export const API = (process.env.API_BASE_URL || "https://aiprove.fun").replace(/\/$/, "");
const KP_FILE = path.resolve(process.env.KEYPAIR_FILE || "./agent-keypair.json");

export function loadWallet() {
  if (process.env.AGENT_PRIVATE_KEY) {
    const key = process.env.AGENT_PRIVATE_KEY.trim();
    return new Wallet(key.startsWith("0x") ? key : "0x" + key);
  }
  if (fs.existsSync(KP_FILE)) {
    const data = JSON.parse(fs.readFileSync(KP_FILE, "utf8"));
    return new Wallet(data.privateKey);
  }
  const w = Wallet.createRandom();
  fs.writeFileSync(
    KP_FILE,
    JSON.stringify({ address: w.address, privateKey: w.privateKey }, null, 2),
    { mode: 0o600 }
  );
  console.log(`[keypair] generated fresh keypair (${w.address})`);
  return w;
}

export async function readSkill() {
  const res = await fetch(`${API}/skill.md`);
  if (!res.ok) throw new Error(`skill.md fetch failed: HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes("/api/auth/challenge")) throw new Error("skill.md lacks the auth flow");
  return text;
}

export class Board {
  constructor(wallet) {
    this.wallet = wallet;
    this.token = null;
  }

  async call(pathname, { method = "GET", body } = {}) {
    const res = await fetch(`${API}${pathname}`, {
      method,
      headers: {
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${method} ${pathname}: ${text.slice(0, 300)}`);
    return json;
  }

  async authenticate() {
    const { challenge } = await this.call(
      `/api/auth/challenge?address=${this.wallet.address}`
    );
    if (!challenge) throw new Error("no challenge returned");
    const signature = await this.wallet.signMessage(challenge);
    const session = await this.call("/api/auth/verify", {
      method: "POST",
      body: { address: this.wallet.address, signature },
    });
    if (!session.token) throw new Error(`verify failed: ${JSON.stringify(session).slice(0, 200)}`);
    this.token = session.token;
    return session;
  }

  async listOpen() {
    const list = await this.call("/api/bounties?status=open");
    return Array.isArray(list) ? list : list.bounties || list.items || [];
  }

  async enter(slug, handle) {
    return this.call(`/api/bounties/${slug}/enter`, {
      method: "POST",
      body: { handle },
    });
  }

  async submitPrediction(slug, prediction, handle) {
    return this.call(`/api/bounties/${slug}/submit`, {
      method: "POST",
      body: { prediction, handle },
    });
  }

  async mySubmissions() {
    const list = await this.call("/api/me/submissions");
    return Array.isArray(list) ? list : list.submissions || list.items || [];
  }
}
