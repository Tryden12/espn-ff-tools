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

Options:

```bash
node src/scripts/waiverPickups.js --position=RB --limit=15 --week=4
```

- `--position` — filter to a position (`QB`, `RB`, `WR`, `TE`, `D/ST`, `K`).
- `--limit` — number of players to show (default 25).
- `--week` — scoring period to evaluate (defaults to the current week).

Each player's row includes **OPRK** — ESPN's own defense-vs-position
strength ranking for their opponent that week (1 = toughest matchup for the
position, 32 = easiest). Use it alongside projected points, not instead of
them — it's not folded into the ranking math.

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
