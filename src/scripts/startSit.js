const { createClient } = require('../espnClient');
const { getMyTeamId } = require('../myTeam');
const { getRosterForTeam, BENCH_SLOT, IR_SLOT, slotIdToPosition } = require('../roster');
const { optimizeLineup, buildChanges } = require('../lineupOptimizer');
const { loadMatchupLookup } = require('../matchups');
const { proTeamIdToAbbreviation } = require('../positions');
const config = require('../config');

// Display order for lineup slots. Raw lineupSlotId isn't display order — the
// FLEX slot (23) is a starting spot but numerically falls after Bench (20).
const SLOT_DISPLAY_ORDER = [0, 2, 4, 6, 23, 16, 17, 20, 21];

function slotSortKey(lineupSlotId) {
  const index = SLOT_DISPLAY_ORDER.indexOf(lineupSlotId);
  return index === -1 ? SLOT_DISPLAY_ORDER.length : index;
}

function parseArgs(argv) {
  const args = { week: null };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'week') args.week = Number(value);
  }
  return args;
}

function formatOprk(player, getOpponentRank) {
  const matchup = getOpponentRank({ proTeamId: player.proTeamId, positionId: player.positionId });
  if (!matchup || matchup.rank === null) return '-';
  const opponentAbbrev = proTeamIdToAbbreviation[matchup.opponentProTeamId] ?? '?';
  return `${matchup.rank} (v ${opponentAbbrev})`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = createClient();

  const [league, myTeam] = await Promise.all([client.getLeagueInfo({ seasonId: config.seasonId }), getMyTeamId()]);
  const scoringPeriodId = args.week ?? league.currentScoringPeriodId;

  const [roster, getOpponentRank] = await Promise.all([
    getRosterForTeam({ seasonId: config.seasonId, scoringPeriodId, teamId: myTeam.id }),
    loadMatchupLookup({ seasonId: config.seasonId, scoringPeriodId })
  ]);

  const starters = roster.filter((p) => p.lineupSlotId !== BENCH_SLOT && p.lineupSlotId !== IR_SLOT);
  const bench = roster.filter((p) => p.lineupSlotId === BENCH_SLOT);
  const lockedCount = roster.filter((p) => p.isLocked).length;

  const result = optimizeLineup({ starters, bench, lineupPositionCount: league.rosterSettings.lineupPositionCount });
  const changes = buildChanges(result);
  const gain = result.bestTotal - result.baseline;

  console.log(`\nStart/Sit for ${myTeam.name} — Week ${scoringPeriodId}\n`);
  console.log('OPRK: defense rank against this position, 1 = toughest matchup, 32 = easiest.\n');
  if (lockedCount > 0) {
    console.log(`${lockedCount} player(s) already locked (game started) — their slots are fixed.\n`);
  }

  if (changes.length === 0) {
    console.log('Your projected-best lineup is already set. No changes recommended.\n');
  } else {
    console.log(`Optimal lineup change(s) — projected gain: +${gain.toFixed(1)} pts\n`);
    console.table(
      changes.map(({ start, sit, slotId, gain: slotGain }) => ({
        start: `${start.name} (${start.position}, ${start.proTeam})`,
        'start oprk': formatOprk(start, getOpponentRank),
        over: `${sit.name} (${sit.position}, ${sit.proTeam})`,
        'over oprk': formatOprk(sit, getOpponentRank),
        slot: slotIdToPosition[slotId] ?? slotId,
        'proj gain': slotGain.toFixed(1)
      }))
    );
  }

  console.log('\nFull lineup:\n');
  console.table(
    [...starters, ...bench]
      .sort((a, b) => slotSortKey(a.lineupSlotId) - slotSortKey(b.lineupSlotId))
      .map((p) => ({
        slot: slotIdToPosition[p.lineupSlotId] ?? p.lineupSlotId,
        name: p.name,
        pos: p.position,
        team: p.proTeam,
        oprk: formatOprk(p, getOpponentRank),
        injury: p.isInjured ? p.injuryStatus : '-',
        locked: p.isLocked ? 'yes' : '-',
        'proj pts': p.projected.toFixed(1)
      }))
  );
}

main().catch((error) => {
  console.error('Failed to build start/sit recommendations:', error.message);
  process.exit(1);
});
