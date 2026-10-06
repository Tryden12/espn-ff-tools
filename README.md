# ESPN Fantasy Football Tools

CLI tools and a small local web UI for analyzing an ESPN fantasy football
league, built on top of
[espn-fantasy-football-api](https://github.com/mkreiser/ESPN-Fantasy-Football-API).
Player trade values come from [FantasyCalc.com](https://fantasycalc.com).

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

## Web UI

A local web UI ([src/web](src/web)) wraps the same underlying modules the
CLI scripts use, so results match exactly.

```bash
npm run web
```

Then open http://localhost:3000. The home page links to:

- **Curated Suggestions** — the same digest as `curated`, with a week
  selector.
- **My Team** — your current roster with OPRK and lock status per player,
  plus **My Starters Position Strength**: how your actual starters at each
  position (QB, RB, WR, TE, FLEX, D/ST, K) rank against every other team's
  starters, by projected, per-game average, or total points.
- **Lineup Optimizer** — the same exact-optimum lineup solver as
  `startsit`, with a week selector.
- **Waiver Wire Recommendations** — the same ranked free-agent list as
  `waivers`, with filters for position, sort, week, and limit.
- **Trade Recommendations** — the same analysis as `trades`, with a week
  selector.

Set `PORT` in `.env` to run on a different port than the default 3000.

## Data sources

- **ESPN** — rosters, projections, stats, and league settings, via the ESPN
  Fantasy API.
- **FantasyCalc** — redraft (rest-of-season) trade values, used by Trade
  Recommendations and Curated Suggestions
  ([src/fantasyCalc.js](src/fantasyCalc.js)). Values are fetched for your
  league's actual format (team count, PPR, 1QB vs superflex), read from ESPN
  league settings. Players are matched by ESPN player ID, so no name
  matching is needed. FantasyCalc doesn't value K or D/ST.

  Per FantasyCalc's [API docs](https://fantasycalc.com/api-docs) and
  [terms](https://fantasycalc.com/terms-of-usage): responses are cached in
  `.cache/` (gitignored) for 12 hours; only the documented `/values/current`
  endpoint is called; and every page that shows FantasyCalc data includes a
  visible "FantasyCalc.com" attribution link. Personal, non-commercial use
  only.

<details>
<summary><strong>Scripts</strong></summary>

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
  (season points-per-game average), `fpts` (season total points), `owned`
  (% rostered league-wide), `usage` (season-total targets/carries), or
  `usageavg` (per-game targets/carries — see below). `last`, `avg`, and
  `fpts` are only meaningful once games have actually been played. Pass a
  comma-separated list for multi-key sorting, e.g. `--sort=oprk,proj` sorts
  by easiest matchup first, breaking ties by projected points.
  `npm run waivers:rec` is shorthand for `--sort=rec`.

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
- **YTD USAGE / AVG USAGE** ([src/usageStats.js](src/usageStats.js)) —
  targets for WR/TE; carries *and* targets for RB (a PPR league values a
  back's receiving work too, so carries alone would hide it); nothing for
  QB/D-ST/K, where the concept doesn't apply. These are raw per-stat
  volume, not a scored total — an opportunity/workload signal that's often
  more stable than points on a small sample: a player racking up
  targets/carries but scoring inefficiently is a classic buy-low profile,
  and it flags regression risk for a player scoring well on very little
  usage. YTD is the season total; Avg divides by games played (backed out
  from `appliedTotal / appliedAverage`, since ESPN doesn't expose games
  played directly). Sort by either with `--sort=usage` or
  `--sort=usageavg`.

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

Suggests fair trades that improve your team, using FantasyCalc
trade values (see [Data sources](#data-sources)). Also shows your roster's
trade values, league-wide position strength, handcuff chips, and
buy-low/sell-high targets.

```bash
npm run trades
```

Options:

```bash
node src/scripts/tradeRecommendations.js --week=4 --team=nifty --give=pollard,addison --get="ja'marr,burrow"
```

- `--week` — scoring period to evaluate (defaults to the current week).
- `--give` — shop specific players: a comma-separated list of
  case-insensitive name substrings from your roster (each must match exactly
  one player). Only offers built around those players are suggested (1-for-1
  or 1-for-2 for each, or 2-for-1 when you give two or more). The web page
  has the same option as a row of checkboxes above Suggested Trades.
- `--get` — target specific players on other teams: a comma-separated list
  of case-insensitive name substrings (each must match exactly one player).
  Every offer brings back at least one target. Combine with `--give` to ask
  "what would these players of mine get me toward that one?" The web page
  has the same option as a search box with autocomplete.
- `--team` — which team's detailed position-strength breakdown to show
  (defaults to yours). Accepts a team id or a case-insensitive substring of
  the team name, e.g. `--team=nifty` for "Neylan's Nifty Team". Useful for
  scouting a specific trade partner before reaching out. The suggested
  trades, handcuff chips, and buy-low/sell-high sections always stay
  anchored to your own team, since those are actionable recommendations
  for you.

What it shows:

- **Suggested Trades** ([src/tradeEngine.js](src/tradeEngine.js)) — searches
  every 1-for-1, 2-for-1, and 1-for-2 trade with every other team (QB/RB/WR/TE
  worth at least 500), and keeps only trades that pass three checks:
  1. **Fair value** — both sides are within 10% on FantasyCalc value, so it
     isn't a lowball. In a 2-for-1, the second player counts at 85% of their
     value: getting the single best player in a deal is worth a premium,
     since two mid players take two roster spots and can't both fill the one
     lineup slot a star does.
  2. **Improves your team** — your team value gains at least 300. Team value
     is your best possible starting lineup (QB, 2 RB, 2 WR, TE, FLEX, filled
     by trade value) plus partial credit for bench depth: your best healthy
     bench RB/WR/TE counts at 50% of their value and the next at 25%. Depth
     covers byes and injuries, so it's worth something, but much less than a
     starter. Players on IR or ruled OUT get no depth credit, because they
     can't cover anyone. Since the trade is even on total value, it helps you
     when you turn value sitting on your bench into starter quality where
     you're thin.
  3. **Doesn't wreck theirs** — their team value loses no more than 300.
     Managers protect their starters, so a trade that's fair on paper but
     guts their lineup won't get accepted. Because depth counts, a team whose
     backups are all hurt can still come out ahead in a 2-for-1 that gives
     them two healthy bodies, even if they give up the best player in the
     deal.

  Results come in two tiers: **both teams improve** (your surplus fills one
  of their holes, so they're most likely to accept) and **even value** (fair,
  and their team barely changes). Each row shows which side has the value
  edge and how much each team's value changes. To avoid near-duplicates, each
  target player appears once per partner, with at most 2 suggestions per
  partner. Trades that are 10-20% apart show separately as **Near-Miss
  Trades**. Overpays (you give the extra value) are listed first, because
  they can be sent as-is and should be easy to get accepted. Where you'd get
  the extra value, expect to add a throw-in.

  **Shopping specific players** (`--give`, or the checkboxes on the web
  page): only the players you pick are offered, and check 2 relaxes from
  "must improve your team by 300" to "can't cost your team more than 300". Moving a chosen player for fair value is the point, so a sideways
  trade still counts. Results then show which teams would take that player
  at fair value and what you'd get back.

  **Targeting other teams' players** (`--get`, or the search box): only
  the teams that own your targets are searched, and every offer brings back
  at least one target, on its own or with a second player from that team.
  Check 2 relaxes the same way as shopping. Check 3 also relaxes: an offer
  that's a fair price but costs their team more than 300 is kept as a
  **long shot** (ranked last) instead of being hidden, because when you're
  after a specific player, knowing the fair price is useful even if they'd
  probably say no. Up to 5 offers are shown per target.

  Team value is measured in rest-of-season trade value, not weekly
  projections, so the engine may suggest moving a starter when the drop-off
  to your backup is small. In a 1QB league, for example, QB12 and QB19 are
  valued close together. For the same reason, a single bye week doesn't make
  a team look needier.
- **Your Trade Values** — every QB/RB/WR/TE on your roster with their
  FantasyCalc value, position rank, and 30-day value trend. "Starter" means
  part of your best lineup by value, regardless of how your ESPN lineup is
  set. A bench player worth 1,000+ is flagged as a **trade chip**: value
  you aren't using.
- **League Position Strength** ([src/positionStrength.js](src/positionStrength.js))
  — every team's rank at QB/RB/WR/TE, in one grid, color-coded like OPRK. A
  team's "starter value" at a position is the combined trade value of its
  best players there, up to the league's starting slot count for that
  position; anyone beyond that is "surplus". Below the grid, a detail table
  breaks down any one team's starters and surplus per position. It defaults
  to yours; switch it with the team selector to scout a trade partner.
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

Suggested trades, trade values, and position strength use FantasyCalc's
forward-looking values. Sell High / Buy Low and the Watch List still use
season-to-date per-game averages, which are noisy early in a season (one big
game can swing a player's "gap" a lot) and get more reliable as more games
are played. Treat all of it as a starting point for your own judgment, not a
final answer.

### Curated suggestions

A single digest that pulls the top 1-2 actionable moves out of the other
three features, for when you just want "what should I do this week"
without reading every report.

```bash
npm run curated
```

Options:

```bash
node src/scripts/curatedSuggestions.js --week=4
```

- `--week` — scoring period to evaluate (defaults to the current week).

What it shows, in order:

1. **Lineup changes** — the exact optimizer's recommended swaps (same as
   `startsit`).
2. **Waiver add/drops** ([src/addDropFinder.js](src/addDropFinder.js)) —
   the best available free agents matched against your weakest player at the
   same position, so it answers "add who, drop who" together instead of
   leaving you to figure out the drop side yourself. The drop candidate is
   your weakest player by season-per-game average (not just this week's
   projection), so one bad-matchup week for an otherwise-good bench player
   doesn't get them flagged. Normally that's a bench player; if a position
   has no bench depth at all (the usual case for D/ST, K, and sometimes TE,
   which most rosters only carry one of), it falls back to comparing against
   your current starter — the classic streaming move — and marks it
   `starter` so it's clear that's what's happening. Only shown when it's a
   real upgrade (at least 1 projected point) — both sides compared on THIS
   week's projection, deliberately, since early in a season a 2-3 game
   season average is closer to noise than signal (one huge game can put a
   bench piece's average above a star's) while ESPN's weekly projection
   already models matchup and role. The tradeoff: a season-long standout
   having one so-so single-week projection won't clear this bar — for that
   angle, see the Trade Recommendations page's Buy Low and position-strength
   views instead. Anything within 0.5 pts of the bar (up to 3 per position)
   is shown separately under **Near Misses** — a real but modest edge, left
   for your own judgment rather than silently discarded.
3. **Top 1-2 trade ideas** — the best of `trades`' FantasyCalc-based
   suggested trades, with how much each one changes your team value and your
   trade partner's.

The digest keeps itself internally consistent: if step 2 suggests dropping
a player, step 3 won't suggest trading that same player away. It doesn't
check combined effects across steps, though. For example, a waiver drop at
QB plus a trade that sends away your other QB could leave you with a single
QB, so read the moves together before making them all.

</details>
