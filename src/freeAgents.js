const axios = require('axios');
const config = require('./config');

// ESPN computes each player's fantasy point total server-side (`appliedTotal`)
// already applying the league's real scoring rules, including whatever
// weighting/confidence discounting it uses for speculative categories like
// return yardage on non-return players. Recomputing points ourselves from
// raw per-stat projections reliably diverges from this (e.g. a deep bench RB
// with a placeholder 100+ projected kickoff-return-yard line will wildly
// outrank real players), so we read `appliedTotal` straight from the API
// instead of doing our own stat-by-stat multiplication.
async function getFreeAgentAppliedTotals({ seasonId, scoringPeriodId }) {
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${seasonId}/segments/0/leagues/${config.leagueId}`;

  const response = await axios.get(url, {
    params: { scoringPeriodId, view: 'kona_player_info' },
    headers: {
      Cookie: `espn_s2=${config.espnS2}; SWID=${config.swid}`,
      'x-fantasy-filter': JSON.stringify({
        players: {
          filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
          limit: 2000,
          sortPercOwned: { sortAsc: false, sortPriority: 1 }
        }
      })
    }
  });

  const players = response.data?.players ?? [];
  const totals = new Map();

  players.forEach(({ player }) => {
    const stats = player.stats ?? [];
    const projectedEntry = stats.find(
      (s) => s.statSourceId === 1 && s.statSplitTypeId === 1 && s.scoringPeriodId === scoringPeriodId
    );
    const actualEntry = stats.find(
      (s) => s.statSourceId === 0 && s.statSplitTypeId === 1 && s.scoringPeriodId === scoringPeriodId
    );

    totals.set(player.id, {
      projected: projectedEntry?.appliedTotal ?? 0,
      actual: actualEntry && actualEntry.appliedTotal !== -1 ? actualEntry.appliedTotal : 0
    });
  });

  return totals;
}

module.exports = { getFreeAgentAppliedTotals };
