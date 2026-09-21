const axios = require('axios');
const config = require('./config');
const { positionIdToName } = require('./positions');

// Positions where "next man up" opportunity meaningfully shifts value.
const HANDCUFF_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);
const SIDELINED_STATUSES = new Set(['OUT', 'DOUBTFUL', 'INJURY_RESERVE']);

// Only an injury to a player who was actually draft-relevant is worth
// flagging — otherwise two buried, undrafted bench players "ahead of" and
// "behind" each other (both effectively unranked) generates pure noise.
// ESPN's average standard draft rank runs into the thousands for players
// who went undrafted, so 200 comfortably covers every real roster starter
// and most notable backups.
const RELEVANT_RANK_THRESHOLD = 200;

// Fetches every player in the league — rostered on any team, or a free
// agent — with enough info to approximate depth-chart order. ESPN doesn't
// expose real depth charts through this API, so we proxy "ahead of them on
// the depth chart" with average draft rank: preseason draft position
// reflects each team's presumed pecking order without the small-sample
// noise season-to-date stats have in the first few weeks.
async function getLeagueWidePlayers({ seasonId, scoringPeriodId }) {
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${seasonId}/segments/0/leagues/${config.leagueId}`;
  const headers = { Cookie: `espn_s2=${config.espnS2}; SWID=${config.swid}` };

  const [rosterResponse, freeAgentResponse] = await Promise.all([
    axios.get(url, { params: { scoringPeriodId, view: 'mRoster' }, headers }),
    axios.get(url, {
      params: { scoringPeriodId, view: 'kona_player_info' },
      headers: {
        ...headers,
        'x-fantasy-filter': JSON.stringify({
          players: {
            filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
            limit: 2000,
            sortPercOwned: { sortAsc: false, sortPriority: 1 }
          }
        })
      }
    })
  ]);

  const rosteredPlayers = (rosterResponse.data?.teams ?? []).flatMap((team) =>
    team.roster.entries.map((entry) => entry.playerPoolEntry.player)
  );
  const freeAgentPlayers = (freeAgentResponse.data?.players ?? []).map(({ player }) => player);

  return [...rosteredPlayers, ...freeAgentPlayers].map((player) => ({
    id: player.id,
    name: player.fullName,
    positionId: player.defaultPositionId,
    proTeamId: player.proTeamId,
    injuryStatus: player.injuryStatus,
    draftRank: player.draftRanksByRankType?.STANDARD?.rank ?? Infinity
  }));
}

// Groups by team+position, ranks by draft rank (the depth-chart proxy), and
// for each player checks whether the teammate immediately ahead of them is
// both sidelined this week and was draft-relevant. Only looks one spot up
// (not every injured player above them) so a long-buried bench player
// doesn't get "boosted" by an unrelated injury three names up the chart.
function findOpportunityBoosts(players) {
  const boosts = new Map(); // playerId -> { name, injuryStatus }
  const groups = new Map(); // "proTeamId:positionId" -> players[]

  players.forEach((p) => {
    if (!HANDCUFF_POSITIONS.has(positionIdToName[p.positionId])) return;
    const key = `${p.proTeamId}:${p.positionId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  });

  groups.forEach((group) => {
    const sorted = [...group].sort((a, b) => a.draftRank - b.draftRank);
    for (let i = 1; i < sorted.length; i++) {
      const ahead = sorted[i - 1];
      const player = sorted[i];
      if (SIDELINED_STATUSES.has(ahead.injuryStatus) && ahead.draftRank <= RELEVANT_RANK_THRESHOLD) {
        boosts.set(player.id, { name: ahead.name, injuryStatus: ahead.injuryStatus });
      }
    }
  });

  return boosts;
}

module.exports = { getLeagueWidePlayers, findOpportunityBoosts };
