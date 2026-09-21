const axios = require('axios');
const config = require('./config');
const { positionIdToName, slotIdToPosition, proTeamIdToAbbreviation } = require('./positions');

const BENCH_SLOT = 20;
const IR_SLOT = 21;

// Same rationale as src/freeAgents.js: read ESPN's own server-computed
// `appliedTotal` rather than recomputing points from raw per-stat
// projections, which include unreliable placeholder values.
function extractAppliedTotals(stats, scoringPeriodId) {
  const projectedEntry = stats.find(
    (s) => s.statSourceId === 1 && s.statSplitTypeId === 1 && s.scoringPeriodId === scoringPeriodId
  );
  const actualEntry = stats.find(
    (s) => s.statSourceId === 0 && s.statSplitTypeId === 1 && s.scoringPeriodId === scoringPeriodId
  );

  return {
    projected: projectedEntry?.appliedTotal ?? 0,
    actual: actualEntry && actualEntry.appliedTotal !== -1 ? actualEntry.appliedTotal : null
  };
}

async function getRosterForTeam({ seasonId, scoringPeriodId, teamId }) {
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${seasonId}/segments/0/leagues/${config.leagueId}`;

  const response = await axios.get(url, {
    params: { scoringPeriodId, view: 'mRoster' },
    headers: { Cookie: `espn_s2=${config.espnS2}; SWID=${config.swid}` }
  });

  const team = (response.data?.teams ?? []).find((t) => t.id === teamId);
  if (!team) {
    throw new Error(`No roster found for team ${teamId}`);
  }

  return team.roster.entries.map((entry) => {
    const player = entry.playerPoolEntry.player;
    const { projected, actual } = extractAppliedTotals(player.stats ?? [], scoringPeriodId);

    return {
      id: player.id,
      name: player.fullName,
      positionId: player.defaultPositionId,
      position: positionIdToName[player.defaultPositionId] ?? '-',
      proTeamId: player.proTeamId,
      proTeam: proTeamIdToAbbreviation[player.proTeamId] ?? '-',
      lineupSlotId: entry.lineupSlotId,
      eligibleSlots: player.eligibleSlots ?? [],
      injuryStatus: player.injuryStatus,
      isInjured: player.injured,
      // True once this player's own NFL game has kicked off — their lineup
      // slot can no longer be changed, so they can't be part of a swap.
      isLocked: Boolean(entry.playerPoolEntry.lineupLocked),
      projected,
      actual
    };
  });
}

module.exports = { getRosterForTeam, BENCH_SLOT, IR_SLOT, slotIdToPosition };
