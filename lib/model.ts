// Launch Radar model: turn the sealed DefiLlama snapshot into a ranked board
// of protocols that record no token yet, each with an implied launch value and
// a concrete plan for farming it before a token exists.
//
// The value model is priced off the snapshot itself, never off a kept list of
// names. Protocols whose token already trades give, category by category, the
// market's own answer to "what is a dollar of TVL worth as a token?": the
// median market-cap-to-TVL ratio of the tokenised peers. A pre-token protocol
// is priced at its TVL times that peer multiple, shaded by two more figures
// the snapshot carries: its seven-day TVL momentum and how long DefiLlama has
// tracked it with no token recorded (its maturity). Everything the board
// claims can be recomputed from the snapshot's ten fields per protocol.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  asOf: string;
  floorUsd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  watchlist: boolean;
  peer_multiple: number;
  momentum_factor: number;
  maturity_factor: number;
  age_days: number | null;
}

export interface RadarStats {
  scanned: number;
  tokenised: number;
  shells: number;
  board_size: number;
  watchlist_size: number;
  watchlist_covered: number;
  global_multiple: number;
  as_of: string;
  floor_usd: number;
  shot_category: string | null;
}

/** Parse and lightly validate the sealed snapshot's JSON text. */
export function readSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as {
    as_of: string;
    floor_usd: number;
    protocols: Protocol[];
    watchlist: string[];
  };
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return {
    asOf: raw.as_of,
    floorUsd: raw.floor_usd,
    protocols: raw.protocols,
    watchlist: raw.watchlist,
  };
}

/** A protocol records no token when both token fields are null. */
export function recordsNoToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

// Categories that are a wrapped, staked or bridged product of something else,
// so the launch they wait on is another protocol's, not their own.
const SHELL_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const SHELL_WORD = /\b(wrapped|staked|staking)\b/i;

/** True when the protocol is a shell of a token that already trades. */
export function isShellProduct(p: Protocol): boolean {
  if (p.category !== null && SHELL_CATEGORIES.has(p.category)) return true;
  if (VERSION_TAIL.test(p.name)) return true;
  if (SHELL_WORD.test(p.name)) return true;
  return EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const MULTIPLE_FLOOR = 0.02;
const MULTIPLE_CEIL = 3;

export interface PeerMultiples {
  global: number;
  byCategory: Map<string, number>;
  peers: Map<string, number>;
}

/**
 * The market's own pricing of TVL, read off the protocols whose token trades:
 * per category, the median market-cap / TVL ratio, shrunk toward the global
 * median by the peer count so a thin category cannot shout, then clamped to a
 * sane band so one feverish peer set cannot price a launch at 400x TVL.
 */
export function peerMultiples(protocols: Protocol[]): PeerMultiples {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (recordsNoToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? '(none)';
    const list = ratiosByCategory.get(key);
    if (list === undefined) ratiosByCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const global = all.length === 0 ? 0.2 : median(all);
  const byCategory = new Map<string, number>();
  const peers = new Map<string, number>();
  for (const [key, list] of ratiosByCategory) {
    const shrunk = (list.length * median(list) + 4 * global) / (list.length + 4);
    byCategory.set(key, Math.min(MULTIPLE_CEIL, Math.max(MULTIPLE_FLOOR, shrunk)));
    peers.set(key, list.length);
  }
  return { global, byCategory, peers };
}

function multipleFor(p: Protocol, table: PeerMultiples): number {
  return table.byCategory.get(p.category ?? '(none)') ?? table.global;
}

/** Seven-day TVL momentum as a multiplier: +/-30% of TVL swing is worth +/-15%. */
export function momentumFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  const clamped = Math.min(30, Math.max(-30, change7d));
  return 1 + (clamped / 100) * 0.5;
}

const DAY_MS = 86_400_000;

/** Whole days between the day DefiLlama began tracking a protocol and the snapshot's day. */
export function ageDays(listedAt: string | null, asOf: string): number | null {
  if (listedAt === null) return null;
  const days = Math.floor((Date.parse(asOf) - Date.parse(listedAt)) / DAY_MS);
  return Number.isFinite(days) ? Math.max(0, days) : null;
}

/**
 * Maturity as a multiplier: a protocol tracked for two years or more with no
 * token recorded has a proven product and takes no newcomer discount; a fresh
 * listing is priced at three quarters until it has run. Unreported listing
 * dates sit between the two.
 */
export function maturityFactor(age: number | null): number {
  if (age === null) return 0.85;
  return 0.75 + 0.25 * Math.min(age / 730, 1);
}

/** Whole-dollar formatting for plan text: $2.76B, $514M, $950K. */
export function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

// Rough per-transaction network cost in dollars by the chain a plan runs on,
// so every plan can state what its steps cost instead of waving at "gas".
const CHAIN_TX_USD = new Map<string, number>([
  ['Ethereum', 15],
  ['Solana', 0.1],
  ['BNB Chain', 1],
  ['Polygon', 0.5],
  ['Base', 1],
  ['Arbitrum', 1],
  ['Optimism', 1],
  ['Avalanche', 1],
  ['Sui', 0.2],
  ['Aptos', 0.2],
]);

function txCost(chain: string): string {
  const usd = CHAIN_TX_USD.get(chain) ?? 2;
  return usd < 1 ? `about $${usd.toFixed(2)}` : `about $${usd}`;
}

type Family =
  | 'exchange'
  | 'derivatives'
  | 'lending'
  | 'yield'
  | 'curator'
  | 'rwa'
  | 'launchpad'
  | 'prediction'
  | 'privacy'
  | 'chain'
  | 'payments'
  | 'generic';

const FAMILY_BY_CATEGORY = new Map<string, Family>([
  ['Dexs', 'exchange'],
  ['Derivatives', 'derivatives'],
  ['Options', 'derivatives'],
  ['Interest Rate Derivatives', 'derivatives'],
  ['Synthetics', 'derivatives'],
  ['Lending', 'lending'],
  ['CDP', 'lending'],
  ['CDP Manager', 'lending'],
  ['Uncollateralized Lending', 'lending'],
  ['Yield', 'yield'],
  ['Yield Aggregator', 'yield'],
  ['Farm', 'yield'],
  ['Leveraged Farming', 'yield'],
  ['Basis Trading', 'yield'],
  ['Indexes', 'yield'],
  ['Risk Curators', 'curator'],
  ['Onchain Capital Allocator', 'curator'],
  ['Collateral Management', 'curator'],
  ['Collateral Markets', 'curator'],
  ['Liquidity Manager', 'curator'],
  ['RWA', 'rwa'],
  ['Launchpad', 'launchpad'],
  ['Prediction Market', 'prediction'],
  ['Privacy', 'privacy'],
  ['Chain', 'chain'],
  ['Payments', 'payments'],
]);

function familyOf(p: Protocol): Family {
  return (p.category !== null ? FAMILY_BY_CATEGORY.get(p.category) : undefined) ?? 'generic';
}

interface PlanFacts {
  name: string;
  chain: string;
  chainCount: number;
  tvl: string;
  gas: string;
  trend: string;
}

function planFacts(p: Protocol): PlanFacts {
  const chain = p.chains[0] ?? 'Ethereum';
  const trend =
    p.change_7d === null
      ? 'its seven-day TVL change is unreported, so size positions conservatively'
      : p.change_7d >= 0
        ? `its TVL grew ${p.change_7d.toFixed(1)}% in the last seven days, so the product is pulling in users now`
        : `its TVL slipped ${Math.abs(p.change_7d).toFixed(1)}% in the last seven days, so start small and watch the trend`;
  return {
    name: p.name,
    chain,
    chainCount: p.chains.length,
    tvl: fmtUsd(p.tvl_usd),
    gas: txCost(chain),
    trend,
  };
}

// One playbook per family. Every step states the action, what it costs and how
// long it takes; the figures woven in are the protocol's own from the snapshot.
const PLAYBOOKS: Record<Family, (f: PlanFacts) => string[]> = {
  exchange: (f) => [
    `Open ${f.name} on ${f.chain} and connect one wallet you will keep using; a swap transaction there costs ${f.gas}, and ${f.trend}. Setup takes about 20 minutes.`,
    `Swap $250 to $500 of volume a week through ${f.name}'s main pairs, split into at least three separate days, so your history reads as a regular trader, not a burst. Budget ${f.gas} a swap, roughly $10 to $40 a month all-in, for 6 to 10 weeks.`,
    `Add $200 to $400 of liquidity to a flagship pool for at least two full weeks, then withdraw and re-add once, so the record shows a liquidity provider as well as a trader. Watch impermanent loss daily; five minutes a day is enough.`,
    `Use one secondary feature of ${f.name} (a limit order, a cross-chain route or its analytics page) once a week for a month, so the wallet touches the whole product surface, at ${f.gas} a transaction.`,
    `Keep a dated log of every swap and deposit with its transaction hash; if ${f.name} ever opens a claim or a points programme, the log is your proof and your checklist. Review it monthly, 15 minutes, until a token is announced.`,
  ],
  derivatives: (f) => [
    `Create an account on ${f.name} from ${f.chain} and deposit $300 of collateral; funding costs ${f.gas}, and ${f.trend}. Allow 30 minutes for setup and a first test trade.`,
    `Trade small perpetual or options positions two or three days a week, $50 to $100 of margin at modest leverage, closing each within the day, so volume and open-interest history build without one liquidation ending the record. Six to ten weeks of this costs roughly $20 to $60 in fees and funding.`,
    `Post collateral in a second market ${f.name} lists (a different underlying or expiry) once a week, so the account is not a one-market artefact; each move costs ${f.gas} plus spread.`,
    `Hold one position across a weekly funding or settlement boundary each month, so the history includes the product's full cycle, and keep total drawdown under 15% of the deposit while you do.`,
    `Keep a dated log of deposits, trades and fees with hashes; derivatives venues that launch tokens usually weight consistent, non-wash activity, and the log proves yours. Check it monthly in 15 minutes.`,
  ],
  lending: (f) => [
    `Connect one wallet to ${f.name} on ${f.chain} and supply $300 to $500 of a mainstream asset (ETH or a major stablecoin); the deposit costs ${f.gas}, and ${f.trend}. Setup takes about 20 minutes.`,
    `Leave the supply in place for at least eight consecutive weeks, compounding or re-supplying interest monthly, so the record shows duration, not a weekend visit. Monthly upkeep is one transaction at ${f.gas}.`,
    `Borrow no more than 25% against the supply for one week, then repay in full, so the wallet shows both sides of ${f.name}'s market; the round trip costs two transactions at ${f.gas} plus a week's interest.`,
    `Supply a second, smaller position ($100 to $200) in a different market or vault ${f.name} offers, and hold it alongside the first for the same eight weeks, to read as a broad user rather than a single-market one.`,
    `Set a monthly 15-minute review: check the position, the protocol's governance forum and announcements for token or points news, and keep a dated log of every supply and borrow with hashes as claim evidence.`,
  ],
  yield: (f) => [
    `Deposit $300 to $500 into ${f.name}'s flagship vault or farm on ${f.chain}; entry costs ${f.gas}, and ${f.trend}. Read the vault's strategy page first: 30 minutes of setup and reading.`,
    `Stay deposited for at least eight weeks and harvest or compound the yield at least twice, a month apart, so the record shows a holder who works the position, not a passer-by. Each harvest costs ${f.gas}.`,
    `Split a second $150 to $250 across another vault or pool ${f.name} runs, ideally on a second chain if it is live on ${f.chainCount > 1 ? 'one of its other chains' : 'a second strategy at home'}, and hold both positions in parallel for the same period.`,
    `Track the vault's share price or APY weekly in a simple sheet (five minutes a week), so you can show, and see, that your deposit rode the product through calm and rough weeks alike.`,
    `Keep a dated log of deposits, harvests and withdrawals with hashes, and review ${f.name}'s announcements monthly for a token, points or season announcement; vault users with long, documented history are the usual first claim group.`,
  ],
  curator: (f) => [
    `Deposit $300 to $500 into a flagship curated vault on ${f.name} via ${f.chain}; the deposit costs ${f.gas}, and ${f.trend}. Spend 30 minutes reading the curator's strategy and risk notes before funding.`,
    `Hold the position for at least eight consecutive weeks; curated vaults reward duration, and a full quarter of unbroken deposit is the strongest simple signal. Monthly checks take five minutes and cost nothing unless you rebalance.`,
    `Spread a second $150 to $250 across a vault run by a different curator or strategy inside ${f.name}, so your record spans the platform rather than one vault, at ${f.gas} for the extra deposit.`,
    `Move a small part of the position (about 10%) once, mid-way, between two vaults, so the history shows an active allocator who reads risk, not a parked wallet; the switch costs two transactions at ${f.gas}.`,
    `Keep a dated log of deposits and switches with hashes and a monthly 15-minute review of curator reports and ${f.name}'s announcements, watching for a points programme or token news that usually follows curator growth.`,
  ],
  rwa: (f) => [
    `Register on ${f.name} from ${f.chain} and complete whatever onboarding or allow-list step it asks of retail users; ${f.trend}. Allow 45 minutes, since real-world-asset platforms often verify identity before a first deposit.`,
    `Make a first deposit of $300 to $500 into its flagship asset or vault and hold it through at least two full yield or reporting periods, typically 8 to 12 weeks, so the record spans the product's real cycle. Entry costs ${f.gas} on chain.`,
    `Add a second, smaller position ($150 to $250) in a different asset class ${f.name} offers (for example credit beside treasuries), so the account reads as a platform user rather than a single-product one.`,
    `Claim or compound every distribution the positions pay while you hold them, on schedule; each claim costs ${f.gas}, and an unbroken claim history is the clearest long-term-user signal these platforms keep.`,
    `Keep a dated log of deposits, claims and statements with hashes, and review ${f.name}'s announcements monthly for token or holder-reward news; RWA platforms that launch tokens usually start from their longest-held depositors.`,
  ],
  launchpad: (f) => [
    `Create an account on ${f.name} via ${f.chain} and complete its profile or allow-list steps; ${f.trend}. Setup takes about 30 minutes and costs ${f.gas} for the on-chain steps.`,
    `Take part in the next two or three launches ${f.name} runs, committing $100 to $200 to each, so the account shows repeated participation rather than a single attempt; budget the commitment plus ${f.gas} per launch.`,
    `Hold at least one launched allocation past its first month instead of selling on day one, and keep the rest of the record clean: no instant flips, which launchpads can and do filter out.`,
    `Use one secondary surface of ${f.name} (staking its access tier, voting, or its secondary market) once a month for a quarter, so the wallet touches the whole platform.`,
    `Keep a dated log of every commitment, allocation and claim with hashes, and check ${f.name}'s announcements monthly; launchpad tokens, when they come, usually reward the accounts with the longest participation history first.`,
  ],
  prediction: (f) => [
    `Fund a ${f.name} account from ${f.chain} with $200 to $300; the deposit costs ${f.gas}, and ${f.trend}. Setup and a first market read take about 30 minutes.`,
    `Trade two or three markets a week in small size ($10 to $25 a position) for 6 to 10 weeks, favouring markets you can actually research, so the account builds a long, varied, non-sybil history. Fees and spread over the run: roughly $15 to $40.`,
    `Provide liquidity or take the unpopular side in one thin market each week, holding to settlement at least twice, so the record includes settled positions and not only quick exits.`,
    `Keep every position honest and in one account: no wash trades against yourself and no burst of activity in a single day, the two patterns prediction platforms filter hardest when they reward users.`,
    `Keep a dated log of deposits, trades and settlements with hashes, and review ${f.name}'s announcements monthly; a token, if it comes, will be aimed at the accounts with exactly this kind of long record.`,
  ],
  privacy: (f) => [
    `Set up ${f.name} from ${f.chain} with a fresh wallet dedicated to it, and make a first small deposit ($150 to $250) to learn the flow; the deposit costs ${f.gas}, and ${f.trend}. Allow 45 minutes for careful setup.`,
    `Use the product the way it is meant to be used: a private transfer or shielded payment once a week for 6 to 10 weeks, in ordinary amounts, so the record is a real user's and not a burst. Each use costs ${f.gas}.`,
    `Keep the dedicated wallet's hygiene strict for the whole run: no mixing with your public farming wallets, no public posts of its addresses, and a written note of its seed stored offline.`,
    `Try one second feature of ${f.name} (a different asset, chain or its compliance or viewing-key tooling) once a month, so the history covers the product's surface.`,
    `Keep a private, dated log of deposits and uses with hashes, stored offline with the wallet's records, and check ${f.name}'s announcements monthly for token news that privacy tools usually break to their user base first.`,
  ],
  chain: (f) => [
    `Bridge $300 to $500 onto the chain through ${f.name}'s canonical route (its TVL is counted on ${f.chainCount > 1 ? `${f.chain} and ${f.chainCount - 1} other chains` : f.chain}) and set up a wallet profile there; bridging costs ${f.gas} plus any bridge fee, and ${f.trend}. Allow an hour for the first bridge and setup.`,
    `Be a weekly citizen for 8 to 12 weeks: one or two transactions a week across the chain's main applications (a swap, a lend, a mint), at ${f.gas} or less each, so the address reads as a resident, not a tourist.`,
    `Hold a balance on the chain the whole time (never bridge everything back), and keep at least $150 of it working in one native application for the full period.`,
    `Use the chain's own infrastructure once a month: its bridge back, its explorer or faucet, a governance vote where one exists, so the record touches the chain itself and not only its apps.`,
    `Keep a dated log of bridges and activity with hashes, and watch ${f.name}'s announcements monthly; when a chain launches its token, long-resident addresses with exactly this record are the usual airdrop core.`,
  ],
  payments: (f) => [
    `Sign up to ${f.name} from ${f.chain} and complete its onboarding, linking one wallet you will keep; ${f.trend}. Allow 30 minutes, more if it verifies identity.`,
    `Route real payments through it weekly for 8 to 12 weeks: pay one bill, invoice or transfer of $50 to $200 each week, so the account builds the steady volume history payment products reward. On-chain steps cost ${f.gas}.`,
    `Hold a working balance of $200 to $300 in the account between payments instead of emptying it each time, so the record shows a user who keeps funds on the platform.`,
    `Use one extra rail ${f.name} offers (a card, an off-ramp, a second currency or chain) at least twice during the run, so the profile spans the product.`,
    `Keep a dated log of payments and balances with references or hashes, and review ${f.name}'s announcements monthly; payment platforms that launch tokens start from accounts with long, ordinary, documented usage.`,
  ],
  generic: (f) => [
    `Open ${f.name} on ${f.chain} and connect one wallet you will keep using for it; the first transaction costs ${f.gas}, and ${f.trend}. Setup takes about 20 minutes.`,
    `Use ${f.name}'s core product two or three times a week for 6 to 10 weeks with $200 to $500 committed in total, in ordinary sizes, so the record reads as a genuine user with a history, not a one-day burst.`,
    `Touch a second feature or market of ${f.name} at least once a month during the run, so the wallet's history covers the product's surface rather than a single button.`,
    `Keep the same wallet and a steady cadence for the whole run: one wallet, no splitting across addresses, no sudden volume spike in the final week, the patterns token launches usually filter out.`,
    `Keep a dated log of every deposit and action with hashes, and review ${f.name}'s announcements monthly for a token, points or season announcement; if one comes, the log is your evidence and your checklist.`,
  ],
};

/** The farm plan for one protocol: five concrete steps from its family's playbook. */
export function farmPlan(p: Protocol): string[] {
  const facts = planFacts(p);
  const steps = PLAYBOOKS[familyOf(p)](facts);
  // Ground the plan in the protocol's own scale: its TVL and chain spread are
  // the reader's first check that this is a substantial, reachable product.
  const spread =
    facts.chainCount > 1
      ? ` It currently holds ${facts.tvl} of TVL across ${facts.chainCount} chains, so there is real usage to join, not a ghost product.`
      : ` It currently holds ${facts.tvl} of TVL on ${facts.chain}, so there is real usage to join, not a ghost product.`;
  steps[0] = `${steps[0]}${spread}`;
  return steps;
}

export interface BuiltBoard {
  rows: BoardRow[];
  stats: RadarStats;
}

/**
 * Build the ranked board: every protocol that records no token and is not a
 * shell of one that trades, plus every watchlist slug whatever the heuristics
 * say, priced by the peer model and ranked by implied value.
 */
export function buildBoard(snapshot: Snapshot): BuiltBoard {
  const table = peerMultiples(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  let tokenised = 0;
  let shells = 0;
  const picked: Protocol[] = [];
  for (const p of snapshot.protocols) {
    if (!recordsNoToken(p)) {
      tokenised += 1;
      continue;
    }
    if (isShellProduct(p) && !watch.has(p.slug)) {
      shells += 1;
      continue;
    }
    picked.push(p);
  }
  const rows: BoardRow[] = picked.map((p) => {
    const multiple = multipleFor(p, table);
    const momentum = momentumFactor(p.change_7d);
    const age = ageDays(p.listed_at, snapshot.asOf);
    const maturity = maturityFactor(age);
    const value = Math.max(1, Math.round(p.tvl_usd * multiple * momentum * maturity));
    return {
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: value,
      farm_steps: farmPlan(p),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      watchlist: watch.has(p.slug),
      peer_multiple: Math.round(multiple * 1000) / 1000,
      momentum_factor: Math.round(momentum * 1000) / 1000,
      maturity_factor: Math.round(maturity * 1000) / 1000,
      age_days: age,
    };
  });
  rows.sort(
    (a, b) =>
      b.implied_value_usd - a.implied_value_usd ||
      b.tvl_usd - a.tvl_usd ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });
  // The category the filtered screenshot shows: the one holding most of the watchlist.
  const watchByCategory = new Map<string, number>();
  for (const row of rows) {
    if (row.watchlist) {
      const key = row.category ?? '(none)';
      watchByCategory.set(key, (watchByCategory.get(key) ?? 0) + 1);
    }
  }
  let shotCategory: string | null = null;
  let best = 0;
  for (const [key, count] of watchByCategory) {
    if (count > best) {
      best = count;
      shotCategory = key === '(none)' ? null : key;
    }
  }
  return {
    rows,
    stats: {
      scanned: snapshot.protocols.length,
      tokenised,
      shells,
      board_size: rows.length,
      watchlist_size: snapshot.watchlist.length,
      watchlist_covered: rows.filter((r) => r.watchlist).length,
      global_multiple: Math.round(table.global * 1000) / 1000,
      as_of: snapshot.asOf,
      floor_usd: snapshot.floorUsd,
      shot_category: shotCategory,
    },
  };
}

/** The dashboard's data file: the board and the model's workings, as one script. */
export function dataScript(built: BuiltBoard): string {
  const payload = {
    meta: built.stats,
    model: {
      summary:
        'Implied value = TVL x peer multiple x momentum x maturity. The peer multiple is the median market-cap-to-TVL ratio of tokenised protocols in the same category, shrunk toward the global median and clamped to 0.02-3. Momentum shades the value by the seven-day TVL change (at most +/-15%). Maturity removes a newcomer discount as a protocol\u2019s tracked history lengthens toward two years.',
      global_multiple: built.stats.global_multiple,
    },
    rows: built.rows,
  };
  return `window.RADAR = ${JSON.stringify(payload)};\n`;
}

/** A gate-shaped self-check of the board: a problem string, or null when it passes. */
export function boardProblem(rows: BoardRow[], snapshot: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4000) return `board holds ${rows.length} rows, outside 100 to 4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const row of rows) {
    if (!slugs.has(row.slug)) return `row names a protocol the snapshot does not: ${row.slug}`;
    if (seen.has(row.slug)) return `slug appears twice: ${row.slug}`;
    seen.add(row.slug);
    if (row.implied_value_usd <= 0 || row.implied_value_usd > 100_000_000_000_000) {
      return `implied value out of range for ${row.slug}`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `farm steps out of range for ${row.slug}`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `a farm step for ${row.slug} is ${len} characters, outside 20 to 600`;
    }
  }
  const byRank = [...rows].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < byRank.length; i += 1) {
    if (byRank[i]!.rank !== i + 1) return 'ranks are not exactly 1 to N';
    if (i > 0 && byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) {
      return 'implied value rises as rank ascends';
    }
  }
  if (new Set(rows.map((r) => r.implied_value_usd)).size === 1 && rows.length > 1) {
    return 'every implied value is the same: the board ranks nothing';
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol missing from the board: ${slug}`;
  }
  return null;
}
