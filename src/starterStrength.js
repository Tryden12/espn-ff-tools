const { BENCH_SLOT, IR_SLOT } = require('./roster');

// Unlike src/positionStrength.js (which infers "starters" as the top N
// players by season average, for trade-value purposes), this ranks each
// team's actual current-week starters — whoever is set in a non-bench,
// non-IR lineup slot for the selected week. Includes D/ST and K, which
// positionStrength.js deliberately excludes as trade currency but which are
// perfectly meaningful here as "how strong is my starting D/ST this week".
//
// FLEX (RB/WR/TE-eligible slot) gets its own row rather than being folded
// into the occupant's natural position — it's a distinct roster spot, and
// comparing "who's in my FLEX" against "who's in everyone else's FLEX" is
// the more useful question than hiding it inside the RB/WR/TE totals.
const FLEX_SLOT = 23;
const STARTER_STRENGTH_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'D/ST', 'K'];

const METRIC_FIELDS = { proj: 'projected', avg: 'seasonAverage', total: 'seasonTotal' };
const DEFAULT_METRIC = 'proj';

function computeStarterPositionStrength({ teams, metric = DEFAULT_METRIC }) {
  const valueField = METRIC_FIELDS[metric] ?? METRIC_FIELDS[DEFAULT_METRIC];
  const byTeam = new Map();

  teams.forEach(({ teamId, roster }) => {
    const starters = roster.filter((p) => p.lineupSlotId !== BENCH_SLOT && p.lineupSlotId !== IR_SLOT);
    const positions = {};

    STARTER_STRENGTH_POSITIONS.forEach((pos) => {
      const players = starters
        .filter((p) => (pos === 'FLEX' ? p.lineupSlotId === FLEX_SLOT : p.position === pos && p.lineupSlotId !== FLEX_SLOT))
        .sort((a, b) => b[valueField] - a[valueField]);
      positions[pos] = {
        starters: players,
        starterValue: players.reduce((sum, p) => sum + p[valueField], 0)
      };
    });

    byTeam.set(teamId, { teamId, positions });
  });

  // Rank teams 1 (strongest) to N per position by combined starter value.
  STARTER_STRENGTH_POSITIONS.forEach((pos) => {
    const ranked = [...byTeam.values()].sort((a, b) => b.positions[pos].starterValue - a.positions[pos].starterValue);
    ranked.forEach((team, index) => {
      team.positions[pos].rank = index + 1;
    });
  });

  return byTeam;
}

module.exports = { computeStarterPositionStrength, STARTER_STRENGTH_POSITIONS, METRIC_FIELDS, DEFAULT_METRIC };
