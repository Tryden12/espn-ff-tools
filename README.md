# ESPN Fantasy Football Tools

CLI tools for analyzing an ESPN fantasy football league, built on top of
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
