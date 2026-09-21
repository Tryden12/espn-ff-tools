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

// Same disambiguation-by-seasonId rationale as src/freeAgents.js: ESPN
// includes a prior-season entry with the same statSourceId/statSplitTypeId.
function extractSeasonStats(stats, seasonId) {
  const seasonEntry = stats.find(
    (s) => s.statSourceId === 0 && s.statSplitTypeId === 0 && s.scoringPeriodId === 0 && s.seasonId === seasonId
  );

  return {
    seasonTotal: seasonEntry && seasonEntry.appliedTotal !== -1 ? seasonEntry.appliedTotal : 0,
    seasonAverage: seasonEntry && seasonEntry.appliedAverage !== -1 ? (seasonEntry.appliedAverage ?? 0) : 0
  };
}

function mapRosterEntry(entry, { seasonId, scoringPeriodId }) {
  const player = entry.playerPoolEntry.player;
  const { projected, actual } = extractAppliedTotals(player.stats ?? [], scoringPeriodId);
  const { seasonTotal, seasonAverage } = extractSeasonStats(player.stats ?? [], seasonId);

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
    // Preseason average draft rank — used as a depth-chart-order proxy
    // elsewhere (src/depthChart.js) since ESPN doesn't expose real ones.
    draftRank: player.draftRanksByRankType?.STANDARD?.rank ?? Infinity,
    projected,
    actual,
    seasonTotal,
    seasonAverage
  };
}

async function fetchLeagueRosters({ seasonId, scoringPeriodId }) {
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${seasonId}/segments/0/leagues/${config.leagueId}`;

  const response = await axios.get(url, {
    params: { scoringPeriodId, view: 'mRoster' },
    headers: { Cookie: `espn_s2=${config.espnS2}; SWID=${config.swid}` }
  });

  return response.data?.teams ?? [];
}

async function getRosterForTeam({ seasonId, scoringPeriodId, teamId }) {
  const teams = await fetchLeagueRosters({ seasonId, scoringPeriodId });
  const team = teams.find((t) => t.id === teamId);
  if (!team) {
    throw new Error(`No roster found for team ${teamId}`);
  }

  return team.roster.entries.map((entry) => mapRosterEntry(entry, { seasonId, scoringPeriodId }));
}

// Every team's roster in one call — used for league-wide analysis (position
// strength, trade recommendations) where fetching team-by-team would mean
// N redundant requests for data ESPN already returns all at once.
async function getAllTeamRosters({ seasonId, scoringPeriodId }) {
  const teams = await fetchLeagueRosters({ seasonId, scoringPeriodId });

  return teams.map((team) => ({
    teamId: team.id,
    roster: team.roster.entries.map((entry) => mapRosterEntry(entry, { seasonId, scoringPeriodId }))
  }));
}

module.exports = { getRosterForTeam, getAllTeamRosters, BENCH_SLOT, IR_SLOT, slotIdToPosition };
