// Pump.fun Replay Sprint — paper bot (agent-fun/replay/v2).
//
// Strategy: early-launch sniper with a rug filter and fast exits. Paper money
// only: 10 SOL of capital, no shorts, no leverage. Every decision is
// deterministic — no clock, no randomness, no network — so the two grading
// runs produce identical action logs.
//
// Every coin is watched from its CreateEvent. In its first few slots the bot
// reads the opening tape: how big the creator's own buy was, how many other
// wallets piled in with it (a launch bundled by many wallets in its first
// slots is usually the creator's cluster waiting to dump), whether the
// creator has already sold, and how much real SOL the curve holds. It buys
// only launches that pass, takes profit fast, cuts losers fast, never holds
// past MAX_HOLD slots, and leaves at once when the creator sells.
//
// Why this shape: on pump.fun most new curves go to zero within minutes, so
// holding for momentum rarely pays; the edge, such as it is, is in catching
// the first minutes of the few launches that run, with size small enough
// that the many losers cost little and exits fast enough that a dump does
// not eat the stake. A 0.1 SOL stake per coin across hundreds of launches
// keeps any single rug to ~1% of capital and keeps the run above the
// guardrail bar (a round trip of at least 0.01 SOL on at least 20 coins).

import { runBot, type Batch, type BotState, type OrderInput, type Pubkey } from './vendor/makefun-bot.ts';

const LAMPORTS = 1e9;
const CURVE_FEE = 0.0125; // protocol 95bps + creator 30bps fallback
const MAX_AGE = 3; // oldest age (slots since create) at which a first buy may be decided
const STAKE_SOL = 0.1; // SOL aimed per coin
const MIN_BUY_SOL = 0.005; // smallest buy worth paying the tx fee for
const MIN_REAL_SOL = 0.3; // min real SOL reserve at decision time
const MAX_DEV_BUY_SOL = 2.5; // creator's own buys in the create slot, at most
const MAX_OPEN_BUYERS = 3; // distinct non-creator buyers before entry, at most
const TP = 0.15; // take profit: sell when value reaches cost * (1 + TP)
const SL = 0.12; // stop loss: sell when value falls to cost * (1 - SL)
const MAX_HOLD = 10; // exit after holding this many slots regardless
const BUY_SLIP_BPS = 10_000;

interface Coin {
  createSlot: number;
  creator: Pubkey;
  devBuy: number; // SOL the creator bought in the create slot
  buyers: Set<Pubkey>; // distinct non-creator buyers seen
  devSold: boolean;
  decided: boolean; // a buy was decided for this coin (never buy twice)
  complete: boolean;
}

interface Held {
  openedSlot: number;
}

const coins = new Map<Pubkey, Coin>();
const held = new Map<Pubkey, Held>();

function coinOf(mint: Pubkey, createSlot: number, creator: Pubkey): Coin {
  let c = coins.get(mint);
  if (c === undefined) {
    c = { createSlot, creator, devBuy: 0, buyers: new Set(), devSold: false, decided: false, complete: false };
    coins.set(mint, c);
  }
  return c;
}

/** What selling `tokens` against (vq, vt) would pay after curve fees. */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): number {
  if (tokens <= 0n || vt <= 0n) return 0;
  const q = Number((tokens * vq) / (vt + tokens)) / LAMPORTS;
  return q * (1 - CURVE_FEE);
}

await runBot({
  onBatch(state: BotState, batch: Batch): OrderInput[] {
    const now = batch.slot;
    const traded = new Set<Pubkey>();
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        coinOf(e.mint, e.slot, e.creator);
      } else if (e.event === 'TradeEvent') {
        const c = coins.get(e.mint);
        if (c !== undefined) {
          if (e.user === c.creator) {
            if (e.is_buy && e.slot === c.createSlot) c.devBuy += Number(e.sol_amount) / LAMPORTS;
            if (!e.is_buy) c.devSold = true;
          } else if (e.is_buy) {
            c.buyers.add(e.user);
          }
        }
        traded.add(e.mint);
      } else if (e.event === 'CompleteEvent') {
        const c = coins.get(e.mint);
        if (c !== undefined) c.complete = true;
      }
    }

    const orders: OrderInput[] = [];
    const cap = state.hello.caps.max_orders_per_batch;
    const tx = Number(state.txFeeLamports()) / LAMPORTS;

    // Exits first: take profit, stop loss, time limit, creator sold.
    for (const [mint, h] of held) {
      const pos = state.positions.get(mint);
      const curve = state.curves.get(mint);
      if (pos === undefined) {
        let pending = false;
        for (const po of state.pending.values()) {
          if (po.order.mint === mint) pending = true;
        }
        if (!pending) held.delete(mint);
        continue;
      }
      if (curve === undefined || curve.complete) continue;
      const value = sellValue(BigInt(pos.token_amount), curve.virtual_quote_reserves, curve.virtual_token_reserves) - tx;
      const cost = Number(pos.cost_lamports) / LAMPORTS;
      const c = coins.get(mint);
      const devSold = c !== undefined && c.devSold;
      if (value >= cost * (1 + TP) || value <= cost * (1 - SL) || now - h.openedSlot > MAX_HOLD || devSold) {
        let sellPending = false;
        for (const po of state.pending.values()) {
          if (po.order.mint === mint && po.order.side === 'sell') sellPending = true;
        }
        if (sellPending) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
      }
    }

    // Entries: launches in their first MAX_AGE slots that pass the rug filter.
    let free = Number(state.freeCashLamports()) / LAMPORTS;
    let slotsLeft = state.hello.caps.max_open_positions - state.committedPositionCount();
    for (const mint of traded) {
      if (orders.length >= cap || slotsLeft <= 0) break;
      const c = coins.get(mint);
      if (c === undefined || c.decided || c.complete) continue;
      const age = now - c.createSlot;
      if (age < 0 || age > MAX_AGE) continue;
      if (c.devSold || c.devBuy > MAX_DEV_BUY_SOL || c.buyers.size > MAX_OPEN_BUYERS) continue;
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) continue;
      const rqSol = Number(curve.real_quote_reserves) / LAMPORTS;
      if (rqSol < MIN_REAL_SOL) continue;
      const capSol = Math.floor(Number(state.maxBuyLamports(mint))) / LAMPORTS;
      let amount = Math.min(capSol, STAKE_SOL);
      if (amount > free - tx) amount = free - tx;
      if (amount < MIN_BUY_SOL) continue;
      c.decided = true;
      const lamports = BigInt(Math.floor(amount * LAMPORTS));
      orders.push({ side: 'buy', mint, quote_lamports: lamports, max_slippage_bps: BUY_SLIP_BPS });
      free -= amount + tx;
      slotsLeft--;
      held.set(mint, { openedSlot: now });
    }
    return orders;
  },
});
