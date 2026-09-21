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

Ranks available free agents by projected fantasy points, using your league's
actual scoring settings.

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
