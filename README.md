# ESPN Fantasy Football Tools

CLI tools and a small local web UI for analyzing an ESPN fantasy football
league, built on top of
[espn-fantasy-football-api](https://github.com/mkreiser/ESPN-Fantasy-Football-API).

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in your league details:
   ```bash
   cp .env.example .env
   ```
   - `LEAGUE_ID` / `SEASON_ID` — found in your league's ESPN URL.
   - `ESPN_S2` / `SWID` — required for private leagues. Grab them from
     `espn.com` in Chrome DevTools under Application > Cookies.

## Scripts

### Waiver wire pickups

Ranks available free agents by ESPN's own projected fantasy points for your
league's scoring settings.

```bash
npm run waivers
```

Favorite: top WR pickups ranked by the blended recommendation score for a
given week:

```bash
node src/scripts/waiverPickups.js --position=WR --sort=rec --limit=10 --week=3
```

(or `npm run waivers:rec -- --position=WR --limit=10 --week=3`, using the
`waivers:rec` shortcut below)

Options:

```bash
node src/scripts/waiverPickups.js --position=RB --limit=15 --week=4 --sort=oprk
```

- `--position` — filter to a position (`QB`, `RB`, `WR`, `TE`, `D/ST`, `K`).
- `--limit` — number of players to show (default 25).
- `--week` — scoring period to evaluate (defaults to the current week).
- `--sort` — `proj` (default, ESPN's projected points for the week), `oprk`
  (easiest matchup first), `last` (previous week's actual points), `avg`
  (season points-per-game average), or `fpts` (season total points). `last`,
  `avg`, and `fpts` are only meaningful once games have actually been played.
  Pass a comma-separated list for multi-key sorting, e.g.
  `--sort=oprk,proj` sorts by easiest matchup first, breaking ties by
  projected points. `npm run waivers:rec` is shorthand for `--sort=rec`.

Each player's row includes:

- **OPRK** — ESPN's own defense-vs-position strength ranking for their
  opponent that week (1 = toughest matchup for the position, 32 =
  easiest).
- **OPPORTUNITY** — flags when a draft-relevant teammate ahead of them at
  the same position is OUT/DOUBTFUL/IR this week
  ([src/depthChart.js](src/depthChart.js)). ESPN doesn't expose real depth
  charts, so "ahead of them" is approximated with preseason average draft
  rank (stable from week one, unlike season-to-date stats which are noisy
  in the first few weeks) — and only an injury to someone who was actually
  draft-relevant counts, so two buried bench players don't "boost" each
  other.
- **REC PTS** ([src/recommendation.js](src/recommendation.js)) — a blended
  recommendation score: projected points nudged ±15% by matchup favorability
  and +20% if there's an opportunity boost. It stays in point-equivalent
  units on purpose, and both adjustments are intentionally modest — a big
  point-projection gap will still win over either signal alone. Sort by it
  with `--sort=rec`.
- **LOCKED** — this player's own NFL game for the selected week has already
  started or finished (e.g. checking waivers on a Saturday, after Thursday's
  game). Adding a locked player can't help you this week — "proj pts" is
  now stale (it was the pregame projection for a game that already
  happened), while "actual pts" reflects what they actually did. Locked
  rows are still shown (still worth adding for next week) but visually
  dimmed so they don't get confused with players who haven't played yet.

### Start/sit recommendations

Finds your team (matched by the `SWID` in `.env`) and computes the
maximum-projected-points lineup, given your league's roster slots and each
player's slot eligibility.

```bash
npm run startsit
```

Options:

```bash
node src/scripts/startSit.js --week=4
```

- `--week` — scoring period to evaluate (defaults to the current week).

This is an exact optimizer ([src/lineupOptimizer.js](src/lineupOptimizer.js)),
not a one-swap-at-a-time heuristic: it solves the full assignment of players
to slots (including shared FLEX contention between positions) via bitmask
dynamic programming, so it won't miss a multi-way reshuffle the way a greedy
"weakest starter" comparison can. Always sanity-check suggestions against
matchups and injury designations before making changes — this is purely
projection-driven.

Players whose NFL game has already started are locked in their current slot
and excluded from the optimization (shown in the lineup table with
`locked: yes`).

Both the lineup and the recommended changes show **OPRK** for each player's
matchup that week (same scale as above). The optimizer's ranking is still
driven entirely by ESPN's projected points — OPRK is shown for context, e.g.
to help you decide between two close options, not blended into the math.

### Trade recommendations

Analyzes your team's positional strength against the rest of the league and
suggests trades, handcuff chips, and buy-low/sell-high targets.

```bash
npm run trades
```

Options:

```bash
node src/scripts/tradeRecommendations.js --week=4 --team=nifty
```

- `--week` — scoring period to evaluate (defaults to the current week).
- `--team` — which team's detailed position-strength breakdown to show
  (defaults to yours). Accepts a team id or a case-insensitive substring of
  the team name, e.g. `--team=nifty` for "Neylan's Nifty Team". Useful for
  scouting a specific trade partner before reaching out. The suggested
  trades, handcuff chips, and buy-low/sell-high sections always stay
  anchored to your own team, since those are actionable recommendations
  for you.

What it shows:

- **League Position Strength** ([src/positionStrength.js](src/positionStrength.js))
  — every team's rank at each of QB/RB/WR/TE (K/D-ST excluded — rarely
  trade currency), in one grid, color-coded like OPRK. A team's "starter
  value" at a position is the season-per-game average across its best
  players there, up to the league's actual starting slot count for that
  position; anyone beyond that is "surplus" — tradeable depth not needed to
  fill the starting lineup. Below the grid, a detail table breaks down any
  one team's starters/surplus per position — defaults to yours, switch it
  with the team selector to scout a potential trade partner.
- **Suggested Trades** ([src/tradeFinder.js](src/tradeFinder.js)) — offers
  your best surplus player at a strong position for another team's best
  surplus player at one of your weak positions, but only when it's a real
  upgrade over what you're currently starting there. Two tiers: **mutual
  need** (they're also weak where you're strong — likely to say yes) and
  **upgrade only** (they have the depth to spare it, but may not want your
  side as much). With a small league, requiring both sides' needs to align
  is often too strict to find anything, hence the second, less-certain
  tier.
- **Handcuff Trade Chips** ([src/handcuffs.js](src/handcuffs.js)) — RBs on
  your roster that are a clear backup (not just a committee partner — the
  starter has to be meaningfully better ranked) to a starter owned by
  another team. Scoped to RB only: a team's WR2 already gets real usage
  regardless of WR1's health, so it doesn't carry the same all-or-nothing
  insurance value a true RB handcuff does. Since ESPN doesn't expose real
  depth charts, "backup" is approximated with preseason average draft rank,
  same technique as the waiver page's opportunity signal
  ([src/depthChart.js](src/depthChart.js)).
- **Sell High / Buy Low** ([src/valueGaps.js](src/valueGaps.js)) — compares
  each player's preseason draft rank against their current-season rank by
  per-game average, within their position. A player ranking much better now
  than their preseason slot is a sell-high candidate (their trade value is
  probably ahead of their long-run talent level); much worse is a buy-low
  candidate on another team's roster.
- **Watch List — Possible Future Buy Low's**
  ([src/scheduleWatch.js](src/scheduleWatch.js)) — looks 3 weeks ahead using
  OPRK. Two lists: top players elsewhere in the league (top 20 RB/WR, top 10
  QB, top 5 TE by season average) heading into 2+ matchups against a top-10
  defense — their current owner probably hasn't priced that in yet, so
  watch for a buy-low window to open before it shows up in their actual
  production; and a cross-reference of the existing Buy Low list against
  players whose schedule is about to get easier — a much stronger signal
  than either fact alone.

All of this is driven by season-per-game averages, which are genuinely
noisy this early in a season — one big game can swing a position's
"strength" or a player's "gap" a lot. Treat it as a starting point for your
own judgment, not a final answer, and it gets more reliable as more games
are played.

## Web UI

A local web UI ([src/web](src/web)) wraps the same underlying modules the
CLI scripts use, so results match exactly.

```bash
npm run web
```

Then open http://localhost:3000. The home page links to:

- **My Team** — your current roster with OPRK and lock status per player.
- **Lineup Optimizer** — the same exact-optimum lineup solver as
  `startsit`, with a week selector.
- **Waiver Wire Recommendations** — the same ranked free-agent list as
  `waivers`, with filters for position, sort, week, and limit.
- **Trade Recommendations** — the same analysis as `trades`, with a week
  selector.

Set `PORT` in `.env` to run on a different port than the default 3000.
