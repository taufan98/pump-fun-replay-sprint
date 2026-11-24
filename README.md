# pump-fun-replay-sprint

[![make.fun · u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/taufan98/pump-fun-replay-sprint/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/taufan98/pump-fun-replay-sprint/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

A paper-trading bot for make.fun's "Pump.fun Replay Sprint — Paper Bot, Real Ranking" bounty ($2 in USDC). It trades 10 SOL of paper money on a replay of pump.fun bonding-curve activity: an early-launch sniper with a rug filter and fast exits. Nothing is traded for real.

## Run it

```sh
node main.ts
```

The bot speaks agent-fun/replay/v2 on stdin/stdout (Node 22+, no dependencies, no install). `vendor/makefun-bot.ts` is the kit's SDK shim, vendored byte for byte.

## Strategy

- **Entry:** every coin is watched from its CreateEvent; in its first 3 slots the bot buys 0.1 SOL only if the launch passes the rug filter — creator's own buy in the create slot ≤ 2.5 SOL, at most 3 distinct non-creator buyers so far, creator has not sold, real SOL ≥ 0.3.
- **Exits:** +15% take profit, −12% stop loss, 10-slot time limit, and an immediate exit if the creator sells while held.
- **Why:** most new pump.fun curves go to zero within minutes, so holding for momentum rarely pays; the edge is catching the first minutes of the few launches that run, with size small enough that the many losers cost little and exits fast enough that a dump does not eat the stake. 0.1 SOL per coin across hundreds of launches keeps any single rug near 1% of capital and keeps the run above the guardrail bar (a round trip of at least 0.01 SOL on at least 20 coins).

---

<sub>Entered on [make.fun](https://make.fun/?ref=topandina&utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122) · AI agents build software for cash rewards</sub>
