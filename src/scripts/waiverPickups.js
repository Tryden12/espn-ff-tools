const { createClient } = require('../espnClient');
const { getFreeAgentDetails } = require('../freeAgents');
const { loadMatchupLookup } = require('../matchups');
const { proTeamIdToAbbreviation } = require('../positions');
const config = require('../config');

function parseArgs(argv) {
  const args = { position: null, limit: 25, week: null };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'position') args.position = value.toUpperCase();
    if (key === 'limit') args.limit = Number(value);
    if (key === 'week') args.week = Number(value);
  }
  return args;
}

function formatOprk(detail, getOpponentRank) {
  if (!detail) return '-';
  const matchup = getOpponentRank({ proTeamId: detail.proTeamId, positionId: detail.positionId });
  if (!matchup || matchup.rank === null) return '-';
  const opponentAbbrev = proTeamIdToAbbreviation[matchup.opponentProTeamId] ?? '?';
  return `${matchup.rank} (v ${opponentAbbrev})`;
}

function formatRow(player, details, getOpponentRank) {
  const detail = details.get(player.id);
  const { position, projected, actual } = detail ?? { position: player.defaultPosition, projected: 0, actual: 0 };
  return {
    name: player.fullName,
    position,
    team: player.proTeamAbbreviation,
    oprk: formatOprk(detail, getOpponentRank),
    '% owned': player.percentOwned?.toFixed(1) ?? '-',
    '% change': player.percentChange?.toFixed(1) ?? '-',
    injury: player.isInjured ? player.injuryStatus : '-',
    'proj pts': projected.toFixed(1),
    'last pts': actual.toFixed(1)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = createClient();

  const league = await client.getLeagueInfo({ seasonId: config.seasonId });
  const scoringPeriodId = args.week ?? league.currentScoringPeriodId;

  const [freeAgents, details, getOpponentRank] = await Promise.all([
    client.getFreeAgents({ seasonId: config.seasonId, scoringPeriodId }),
    getFreeAgentDetails({ seasonId: config.seasonId, scoringPeriodId }),
    loadMatchupLookup({ seasonId: config.seasonId, scoringPeriodId })
  ]);

  let candidates = freeAgents.filter((player) => !player.isInjured || player.injuryStatus !== 'OUT');
  if (args.position) {
    candidates = candidates.filter((player) => details.get(player.id)?.position === args.position);
  }

  const ranked = candidates
    .sort((a, b) => (details.get(b.id)?.projected ?? 0) - (details.get(a.id)?.projected ?? 0))
    .slice(0, args.limit)
    .map((player) => formatRow(player, details, getOpponentRank));

  console.log(`\nTop waiver pickups for ${league.name} — Week ${scoringPeriodId}${args.position ? ` (${args.position})` : ''}\n`);
  console.log('OPRK: defense rank against this position, 1 = toughest matchup, 32 = easiest.\n');
  console.table(ranked);
}

main().catch((error) => {
  console.error('Failed to fetch waiver pickups:', error.message);
  process.exit(1);
});
