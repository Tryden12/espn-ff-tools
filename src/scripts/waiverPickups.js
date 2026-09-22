const { createClient } = require('../espnClient');
const { getFreeAgentDetails } = require('../freeAgents');
const { loadMatchupLookup } = require('../matchups');
const { getLeagueWidePlayers, findOpportunityBoosts } = require('../depthChart');
const { proTeamIdToAbbreviation } = require('../positions');
const { computeRecommendationScore } = require('../recommendation');
const { computeGamesPlayed, formatUsageTotal, formatUsageAverage, usageSortValue } = require('../usageStats');
const config = require('../config');

const SORT_KEYS = ['proj', 'oprk', 'last', 'avg', 'fpts', 'rec', 'owned', 'usage', 'usageavg'];

function parseArgs(argv) {
  const args = { position: null, limit: 25, week: null, sort: ['proj'] };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'position') args.position = value.toUpperCase();
    if (key === 'limit') args.limit = Number(value);
    if (key === 'week') args.week = Number(value);
    if (key === 'sort') args.sort = value.toLowerCase().split(',');
  }
  const invalid = args.sort.filter((key) => !SORT_KEYS.includes(key));
  if (invalid.length > 0) {
    throw new Error(`--sort has invalid key(s) [${invalid.join(', ')}] — must be one of: ${SORT_KEYS.join(', ')}`);
  }
  return args;
}

function getOprkMatchup(detail, getOpponentRank) {
  if (!detail) return null;
  return getOpponentRank({ proTeamId: detail.proTeamId, positionId: detail.positionId });
}

function getRecommendationScore(player, details, getOpponentRank, opportunityBoosts) {
  const detail = details.get(player.id);
  if (!detail) return -Infinity;

  const oprkRank = getOprkMatchup(detail, getOpponentRank)?.rank ?? null;
  return computeRecommendationScore({
    projected: detail.projected ?? 0,
    oprkRank,
    hasOpportunityBoost: opportunityBoosts.has(player.id)
  });
}

// Higher is always "better" here, so every sort mode can share one
// descending comparator. Missing data (e.g. no OPRK on a bye) sorts last.
function getSortValue(player, details, getOpponentRank, opportunityBoosts, sortBy) {
  const detail = details.get(player.id);
  if (!detail) return -Infinity;

  if (sortBy === 'oprk') {
    return getOprkMatchup(detail, getOpponentRank)?.rank ?? -Infinity;
  }
  if (sortBy === 'rec') {
    return getRecommendationScore(player, details, getOpponentRank, opportunityBoosts);
  }
  if (sortBy === 'last') return detail.actual ?? -Infinity;
  if (sortBy === 'avg') return detail.seasonAverage ?? -Infinity;
  if (sortBy === 'fpts') return detail.seasonTotal ?? -Infinity;
  if (sortBy === 'owned') return player.percentOwned ?? -Infinity;
  if (sortBy === 'usage' || sortBy === 'usageavg') {
    const usage = { targets: detail.seasonTargets, carries: detail.seasonCarries };
    const gamesPlayed = computeGamesPlayed(detail);
    return usageSortValue(detail.position, usage, { perGame: sortBy === 'usageavg', gamesPlayed });
  }
  return detail.projected ?? -Infinity;
}

function formatOprk(detail, getOpponentRank) {
  const matchup = getOprkMatchup(detail, getOpponentRank);
  if (!matchup || matchup.rank === null) return '-';
  const opponentAbbrev = proTeamIdToAbbreviation[matchup.opponentProTeamId] ?? '?';
  return `${matchup.rank} (v ${opponentAbbrev})`;
}

function formatOpportunity(player, opportunityBoosts) {
  const boost = opportunityBoosts.get(player.id);
  if (!boost) return '-';
  return `↑ (${boost.name} ${boost.injuryStatus})`;
}

function formatRow(player, details, getOpponentRank, opportunityBoosts) {
  const detail = details.get(player.id);
  const { position, projected, actual, seasonTotal, seasonAverage, isLocked } = detail ?? {
    position: player.defaultPosition,
    projected: 0,
    actual: 0,
    seasonTotal: 0,
    seasonAverage: 0,
    isLocked: false
  };
  const recScore = getRecommendationScore(player, details, getOpponentRank, opportunityBoosts);
  const usage = { targets: detail?.seasonTargets ?? 0, carries: detail?.seasonCarries ?? 0 };
  const gamesPlayed = detail ? computeGamesPlayed(detail) : 0;

  return {
    name: player.fullName,
    position,
    team: player.proTeamAbbreviation,
    oprk: formatOprk(detail, getOpponentRank),
    opportunity: formatOpportunity(player, opportunityBoosts),
    locked: isLocked ? 'yes' : '-',
    '% owned': player.percentOwned?.toFixed(1) ?? '-',
    '% change': player.percentChange?.toFixed(1) ?? '-',
    injury: player.isInjured ? player.injuryStatus : '-',
    'proj pts': projected.toFixed(1),
    'rec pts': recScore.toFixed(1),
    'actual pts': isLocked ? actual.toFixed(1) : '-',
    avg: seasonAverage.toFixed(1),
    'ytd fpts': seasonTotal.toFixed(1),
    'ytd usage': formatUsageTotal(position, usage),
    'avg usage': formatUsageAverage(position, usage, gamesPlayed)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = createClient();

  const league = await client.getLeagueInfo({ seasonId: config.seasonId });
  const scoringPeriodId = args.week ?? league.currentScoringPeriodId;

  const [freeAgents, details, getOpponentRank, leagueWidePlayers] = await Promise.all([
    client.getFreeAgents({ seasonId: config.seasonId, scoringPeriodId }),
    getFreeAgentDetails({ seasonId: config.seasonId, scoringPeriodId }),
    loadMatchupLookup({ seasonId: config.seasonId, scoringPeriodId }),
    getLeagueWidePlayers({ seasonId: config.seasonId, scoringPeriodId })
  ]);
  const opportunityBoosts = findOpportunityBoosts(leagueWidePlayers);

  let candidates = freeAgents.filter((player) => !player.isInjured || player.injuryStatus !== 'OUT');
  if (args.position) {
    candidates = candidates.filter((player) => details.get(player.id)?.position === args.position);
  }

  const ranked = candidates
    .sort((a, b) => {
      for (const sortBy of args.sort) {
        const diff =
          getSortValue(b, details, getOpponentRank, opportunityBoosts, sortBy) -
          getSortValue(a, details, getOpponentRank, opportunityBoosts, sortBy);
        if (diff !== 0) return diff;
      }
      return 0;
    })
    .slice(0, args.limit)
    .map((player) => formatRow(player, details, getOpponentRank, opportunityBoosts));

  console.log(
    `\nTop waiver pickups for ${league.name} — Week ${scoringPeriodId}${args.position ? ` (${args.position})` : ''} — sorted by ${args.sort.join(' > ')}\n`
  );
  console.log('OPRK: defense rank against this position, 1 = toughest matchup, 32 = easiest.');
  console.log('OPPORTUNITY: a draft-relevant teammate ahead of them is OUT/DOUBTFUL/IR this week.');
  console.log('LOCKED: this player\'s game for the selected week has already started/finished — adding them');
  console.log('  won\'t help this week, "proj pts" is now stale, but "actual pts" reflects their real result.');
  console.log('REC PTS: proj pts adjusted by OPRK (±15%) and opportunity (+20%) — sort by "rec" to rank on it.');
  console.log(
    'USAGE: targets (WR/TE) or carries + targets (RB, since receiving work counts in PPR) — opportunity share,' +
      ' often a more stable signal than points on a small sample. Not shown for QB/D-ST/K. Sort by "usage"' +
      ' (season total) or "usageavg" (per game).\n'
  );
  console.table(ranked);
}

main().catch((error) => {
  console.error('Failed to fetch waiver pickups:', error.message);
  process.exit(1);
});
