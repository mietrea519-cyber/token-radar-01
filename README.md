# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mietrea519-cyber/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mietrea519-cyber/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar: a token launch radar for make.fun's "Build the best token launch radar" bounty. The program reads the sealed DefiLlama snapshot of 758 protocols, sets aside the ones whose token already trades and the wrapped, staked or bridged shells of other protocols, and ranks the rest — every protocol that records no token yet — by an implied launch value priced off the snapshot itself: TVL times the median market-cap-to-TVL multiple of tokenised peers in the same category, shaded by seven-day momentum and by how long the protocol has run with no token recorded. Every row carries a concrete farm plan with costs and durations, and the dashboard it writes is sortable and filterable, with a detail view per protocol showing the workings of its value.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

Then open `out/dashboard/index.html` in a browser (it reads `out/data.js`, written by the same run). The ranked rows are in `out/board.json` and the judge's dossier in `out/dossier.json`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=1e3qpbvy&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
