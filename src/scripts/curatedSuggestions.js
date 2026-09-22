const { createClient } = require('../espnClient');
const { getMyTeamId, getAllTeams } = require('../myTeam');
const { getRosterForTeam, getAllTeamRosters, BENCH_SLOT, IR_SLOT, slotIdToPosition } = require('../roster');
const { optimizeLineup, buildChanges } = require('../lineupOptimizer');
const { getFreeAgentDetails } = require('../freeAgents');
const { loadMatchupLookup } = require('../matchups');
const { getLeagueWidePlayers, findOpportunityBoosts } = require('../depthChart');
const { computeRecommendationScore } = require('../recommendation');
const { proTeamIdToAbbreviation } = require('../positions');
const { findAddDropSuggestions, MIN_UPGRADE } = require('../addDropFinder');
const { computeTeamPositionStrength } = require('../positionStrength');
const { findComplementaryTrades } = require('../tradeFinder');
const config = require('../config');

function parseArgs(argv) {
  const args = { week: null };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'week') args.week = Number(value);
  }
  return args;
}

function formatOprk(proTeamId, positionId, getOpponentRank) {
  const matchup = getOpponentRank({ proTeamId, positionId });
  if (!matchup || matchup.rank === null) return '-';
  const opponentAbbrev = proTeamIdToAbbreviation[matchup.opponentProTeamId] ?? '?';
  return `${matchup.rank} (v ${opponentAbbrev})`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = createClient();

  const [league, myTeam, allTeams] = await Promise.all([
    client.getLeagueInfo({ seasonId: config.seasonId }),
    getMyTeamId(),
    getAllTeams()
  ]);
  const scoringPeriodId = args.week ?? league.currentScoringPeriodId;
  const teamNames = new Map(allTeams.map((t) => [t.id, t.name]));

  console.log(`\nCurated Suggestions for ${myTeam.name} — Week ${scoringPeriodId}\n`);

  // --- 1. Lineup ---
  const roster = await getRosterForTeam({ seasonId: config.seasonId, scoringPeriodId, teamId: myTeam.id });
  const starters = roster.filter((p) => p.lineupSlotId !== BENCH_SLOT && p.lineupSlotId !== IR_SLOT);
  const bench = roster.filter((p) => p.lineupSlotId === BENCH_SLOT);

  const lineupResult = optimizeLineup({
    starters,
    bench,
    lineupPositionCount: league.rosterSettings.lineupPositionCount
  });
  const lineupChanges = buildChanges(lineupResult);
  const lineupGain = lineupResult.bestTotal - lineupResult.baseline;

  console.log('=== 1. Set your lineup ===\n');
  if (lineupChanges.length === 0) {
    console.log("Your lineup is already optimal — nothing to change.\n");
  } else {
    console.table(
      lineupChanges.map(({ start, sit, slotId, gain }) => ({
        start: `${start.name} (${start.position}, ${start.proTeam})`,
        over: `${sit.name} (${sit.position}, ${sit.proTeam})`,
        slot: slotIdToPosition[slotId] ?? slotId,
        'proj gain': `+${gain.toFixed(1)}`
      }))
    );
    console.log(`Total projected gain: +${lineupGain.toFixed(1)} pts\n`);
  }

  // --- 2. Waiver add/drop ---
  const [freeAgents, details, getOpponentRank, leagueWidePlayers] = await Promise.all([
    client.getFreeAgents({ seasonId: config.seasonId, scoringPeriodId }),
    getFreeAgentDetails({ seasonId: config.seasonId, scoringPeriodId }),
    loadMatchupLookup({ seasonId: config.seasonId, scoringPeriodId }),
    getLeagueWidePlayers({ seasonId: config.seasonId, scoringPeriodId })
  ]);
  const opportunityBoosts = findOpportunityBoosts(leagueWidePlayers);

  const candidates = freeAgents
    .filter((p) => !p.isInjured || p.injuryStatus !== 'OUT')
    .map((p) => {
      const detail = details.get(p.id);
      if (!detail || detail.isLocked) return null;
      const oprkRank = getOpponentRank({ proTeamId: detail.proTeamId, positionId: detail.positionId })?.rank ?? null;
      const recScore = computeRecommendationScore({
        projected: detail.projected,
        oprkRank,
        hasOpportunityBoost: opportunityBoosts.has(p.id)
      });
      return {
        id: p.id,
        name: p.fullName,
        position: detail.position,
        proTeamId: detail.proTeamId,
        positionId: detail.positionId,
        projected: detail.projected,
        seasonAverage: detail.seasonAverage,
        recScore
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.recScore - a.recScore);

  const { suggestions: addDrops, nearMisses } = findAddDropSuggestions({
    starters,
    benchPlayers: bench,
    candidates,
    limit: 5
  });

  function formatAddDropRow({ add, drop, upgrade, isStreamStart }) {
    return {
      add: `${add.name} (${add.position})`,
      'add oprk': formatOprk(add.proTeamId, add.positionId, getOpponentRank),
      'add proj': add.projected.toFixed(1),
      'add season avg': add.seasonAverage.toFixed(1),
      drop: `${drop.name} (${drop.position})${isStreamStart ? ' [starter]' : ''}`,
      'drop proj': drop.projected.toFixed(1),
      'drop season avg': drop.seasonAverage.toFixed(1),
      upgrade: `+${upgrade.toFixed(1)}`
    };
  }

  console.log('=== 2. Waiver wire moves ===\n');
  if (addDrops.length === 0) {
    console.log('No waiver upgrades clear enough to bother with this week.\n');
  } else {
    console.table(addDrops.map(formatAddDropRow));
    console.log(
      '[starter] = no bench player at that position (common for D/ST/K/single-TE rosters), so this replaces' +
        ' your current starter directly — a streaming move, not a bench upgrade.'
    );
    console.log(
      'Drop candidate = your weakest bench player at that position by season-per-game average (not just this' +
        " week's projection), so a rough single-week matchup for an otherwise-good player doesn't get them cut.\n"
    );
  }

  if (nearMisses.length > 0) {
    console.log(`--- Near misses (real but under the +${MIN_UPGRADE.toFixed(1)} pt bar) ---\n`);
    console.table(nearMisses.map(formatAddDropRow));
    console.log('Shown for your own judgment call — not clear enough upgrades to recommend outright.\n');
  }

  // --- 3. Trade ideas ---
  const rosters = await getAllTeamRosters({ seasonId: config.seasonId, scoringPeriodId });
  const strength = computeTeamPositionStrength({
    teams: rosters,
    lineupPositionCount: league.rosterSettings.lineupPositionCount
  });
  const { complementary, upgradeOnly } = findComplementaryTrades({
    myTeamId: myTeam.id,
    teamStrengths: strength,
    teamNames
  });
  // Don't suggest trading away a player this same digest just told you to
  // drop for a waiver upgrade — the two recommendations would contradict
  // each other.
  const droppedPlayerIds = new Set(addDrops.map((d) => d.drop.id));
  const topTrades = [...complementary, ...upgradeOnly]
    .filter((t) => !droppedPlayerIds.has(t.give.player.id))
    .slice(0, 2);

  console.log('=== 3. Trade ideas ===\n');
  if (topTrades.length === 0) {
    console.log('No clear trade upgrades found this week. See `npm run trades` for the full breakdown.\n');
  } else {
    console.table(
      topTrades.map((t) => ({
        fit: t.tier === 'complementary' ? 'mutual need' : 'upgrade only',
        'trade with': t.withTeamName,
        'you give': `${t.give.player.name} (${t.give.position}, ${t.give.player.seasonAverage.toFixed(1)} avg)`,
        'you get': `${t.get.player.name} (${t.get.position}, ${t.get.player.seasonAverage.toFixed(1)} avg)`,
        'proj upgrade': `+${t.upgrade.toFixed(1)}`
      }))
    );
    console.log('Run `npm run trades` for the full trade breakdown, watch list, and handcuff chips.\n');
  }
}

main().catch((error) => {
  console.error('Failed to build curated suggestions:', error.message);
  process.exit(1);
});
