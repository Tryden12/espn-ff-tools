// Positions worth comparing across teams for trade purposes. D/ST and K are
// excluded — they're rarely trade currency and nearly interchangeable
// week-to-week, so a "strength" ranking there wouldn't be actionable.
const TRADE_POSITIONS = ['QB', 'RB', 'WR', 'TE'];

// A team's "starter value" at a position is the sum of season-per-game
// average points (not season total, so teams with more games played aren't
// unfairly advantaged) across its best N players there, where N is the
// league's actual starting slot count for that position. Anything beyond
// that is "surplus" — bench depth that isn't needed to fill the starting
// lineup and so is realistically available to trade.
function computeTeamPositionStrength({ teams, lineupPositionCount }) {
  const startersNeeded = Object.fromEntries(TRADE_POSITIONS.map((pos) => [pos, lineupPositionCount[pos] ?? 0]));

  const byTeam = new Map();

  teams.forEach(({ teamId, roster }) => {
    const positions = {};

    TRADE_POSITIONS.forEach((pos) => {
      const players = roster
        .filter((p) => p.position === pos)
        .sort((a, b) => b.seasonAverage - a.seasonAverage);

      const starters = players.slice(0, startersNeeded[pos]);
      const surplus = players.slice(startersNeeded[pos]);

      positions[pos] = {
        starters,
        surplus,
        starterValue: starters.reduce((sum, p) => sum + p.seasonAverage, 0)
      };
    });

    byTeam.set(teamId, { teamId, positions });
  });

  // Rank teams 1 (strongest) to N per position by starter value.
  TRADE_POSITIONS.forEach((pos) => {
    const ranked = [...byTeam.values()].sort((a, b) => b.positions[pos].starterValue - a.positions[pos].starterValue);
    ranked.forEach((team, index) => {
      team.positions[pos].rank = index + 1;
    });
  });

  return byTeam;
}

// Rank thresholds scale with league size: top third = strong, bottom third
// = weak, middle = average. Works for the common 8-12 team league sizes.
function categorizeStrength(rank, numTeams) {
  const third = Math.max(1, Math.round(numTeams / 3));
  if (rank <= third) return 'STRONG';
  if (rank > numTeams - third) return 'WEAK';
  return 'AVERAGE';
}

module.exports = { computeTeamPositionStrength, categorizeStrength, TRADE_POSITIONS };
