const axios = require('axios');
const config = require('./config');
const { positionIdToName } = require('./positions');
const { extractSeasonUsage } = require('./usageStats');

// ESPN computes each player's fantasy point total server-side (`appliedTotal`)
// already applying the league's real scoring rules, including whatever
// weighting/confidence discounting it uses for speculative categories like
// return yardage on non-return players. Recomputing points ourselves from
// raw per-stat projections reliably diverges from this (e.g. a deep bench RB
// with a placeholder 100+ projected kickoff-return-yard line will wildly
// outrank real players), so we read `appliedTotal` straight from the API
// instead of doing our own stat-by-stat multiplication.
// Also returns each player's `position`, computed from `defaultPositionId`,
// since espn-fantasy-football-api's own `defaultPosition` field is mislabeled
// for every skill position except RB (see src/positions.js).
async function getFreeAgentDetails({ seasonId, scoringPeriodId }) {
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
  const details = new Map();

  players.forEach(({ player, lineupLocked }) => {
    const stats = player.stats ?? [];
    const projectedEntry = stats.find(
      (s) => s.statSourceId === 1 && s.statSplitTypeId === 1 && s.scoringPeriodId === scoringPeriodId
    );
    const actualEntry = stats.find(
      (s) => s.statSourceId === 0 && s.statSplitTypeId === 1 && s.scoringPeriodId === scoringPeriodId
    );
    // Season-to-date total/average, same numbers ESPN's UI shows as FPTS/AVG.
    // Disambiguated by seasonId since ESPN also includes a prior-season entry
    // with the same statSourceId/statSplitTypeId/scoringPeriodId.
    const seasonEntry = stats.find(
      (s) => s.statSourceId === 0 && s.statSplitTypeId === 0 && s.scoringPeriodId === 0 && s.seasonId === seasonId
    );

    const { targets, carries } = extractSeasonUsage(seasonEntry);

    details.set(player.id, {
      positionId: player.defaultPositionId,
      position: positionIdToName[player.defaultPositionId] ?? '-',
      proTeamId: player.proTeamId,
      projected: projectedEntry?.appliedTotal ?? 0,
      actual: actualEntry && actualEntry.appliedTotal !== -1 ? actualEntry.appliedTotal : 0,
      seasonTotal: seasonEntry && seasonEntry.appliedTotal !== -1 ? seasonEntry.appliedTotal : 0,
      seasonAverage: seasonEntry && seasonEntry.appliedAverage !== -1 ? (seasonEntry.appliedAverage ?? 0) : 0,
      seasonTargets: targets,
      seasonCarries: carries,
      // True once this player's own NFL game (for the requested week) has
      // kicked off. A locked player can't help you THIS week anymore even
      // if you add them now — still worth adding for future weeks, but the
      // projection above is now moot for the remaining games this week.
      isLocked: Boolean(lineupLocked)
    });
  });

  return details;
}

module.exports = { getFreeAgentDetails };
