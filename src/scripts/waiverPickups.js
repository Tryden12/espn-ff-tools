const { createClient } = require('../espnClient');
const { getFreeAgentAppliedTotals } = require('../freeAgents');
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

function formatRow(player, totals) {
  const { projected, actual } = totals.get(player.id) ?? { projected: 0, actual: 0 };
  return {
    name: player.fullName,
    position: player.defaultPosition,
    team: player.proTeamAbbreviation,
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

  const [freeAgents, totals] = await Promise.all([
    client.getFreeAgents({ seasonId: config.seasonId, scoringPeriodId }),
    getFreeAgentAppliedTotals({ seasonId: config.seasonId, scoringPeriodId })
  ]);

  let candidates = freeAgents.filter((player) => !player.isInjured || player.injuryStatus !== 'OUT');
  if (args.position) {
    candidates = candidates.filter((player) => player.defaultPosition === args.position);
  }

  const ranked = candidates
    .sort((a, b) => (totals.get(b.id)?.projected ?? 0) - (totals.get(a.id)?.projected ?? 0))
    .slice(0, args.limit)
    .map((player) => formatRow(player, totals));

  console.log(`\nTop waiver pickups for ${league.name} — Week ${scoringPeriodId}${args.position ? ` (${args.position})` : ''}\n`);
  console.table(ranked);
}

main().catch((error) => {
  console.error('Failed to fetch waiver pickups:', error.message);
  process.exit(1);
});
