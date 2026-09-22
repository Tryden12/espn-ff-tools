const { createClient } = require('../espnClient');
const { getMyTeamId, getAllTeams } = require('../myTeam');
const { getAllTeamRosters } = require('../roster');
const { computeTeamPositionStrength, categorizeStrength, TRADE_POSITIONS } = require('../positionStrength');
const { findComplementaryTrades } = require('../tradeFinder');
const { findHandcuffOpportunities } = require('../handcuffs');
const { computeValueGaps } = require('../valueGaps');
const { loadMultiWeekMatchupLookup } = require('../matchups');
const {
  findToughScheduleWatchList,
  findBuyLowWithFavorableSchedule,
  buildLookaheadWeeks
} = require('../scheduleWatch');
const config = require('../config');

function parseArgs(argv) {
  const args = { week: null, team: null };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'week') args.week = Number(value);
    if (key === 'team') args.team = value;
  }
  return args;
}

// Accepts either a team id or a case-insensitive substring of the team
// name, e.g. --team=nifty for "Neylan's Nifty Team".
function resolveTeamId(teamArg, teamNames) {
  if (teamArg === null) return null;
  const asId = Number(teamArg);
  if (!Number.isNaN(asId) && teamNames.has(asId)) return asId;

  const needle = teamArg.toLowerCase();
  const match = [...teamNames.entries()].find(([, name]) => name.toLowerCase().includes(needle));
  if (!match) {
    throw new Error(`--team "${teamArg}" didn't match any team. Known teams: ${[...teamNames.values()].join(', ')}`);
  }
  return match[0];
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

  const rosters = await getAllTeamRosters({ seasonId: config.seasonId, scoringPeriodId });
  const teamsWithNames = rosters.map((r) => ({ ...r, teamName: teamNames.get(r.teamId) }));

  const strength = computeTeamPositionStrength({
    teams: rosters,
    lineupPositionCount: league.rosterSettings.lineupPositionCount
  });
  const numTeams = strength.size;
  const my = strength.get(myTeam.id);
  const selectedTeamId = resolveTeamId(args.team, teamNames) ?? myTeam.id;
  const selected = strength.get(selectedTeamId);

  console.log(`\nTrade Recommendations for ${myTeam.name} — ${league.name}\n`);
  console.log(
    'Position strength is each team\'s season-per-game average across their starter-count best players' +
      ' at that position — early season, so small-sample noise (one huge game) can skew it. K/D-ST excluded' +
      ' (rarely trade currency).\n'
  );

  console.log('--- League position strength (rank of ' + numTeams + ', 1 = strongest) ---\n');
  console.table(
    [...strength.values()]
      .sort((a, b) => (teamNames.get(a.teamId) ?? '').localeCompare(teamNames.get(b.teamId) ?? ''))
      .map((t) => {
        const row = { team: teamNames.get(t.teamId) + (t.teamId === myTeam.id ? ' (you)' : '') };
        TRADE_POSITIONS.forEach((pos) => {
          row[pos] = t.positions[pos].rank;
        });
        return row;
      })
  );

  console.log(
    `\n--- Position strength detail — ${teamNames.get(selectedTeamId)}${selectedTeamId === myTeam.id ? ' (you)' : ''} ---\n`
  );
  console.table(
    TRADE_POSITIONS.map((pos) => {
      const p = selected.positions[pos];
      return {
        position: pos,
        rank: `${p.rank} of ${numTeams}`,
        category: categorizeStrength(p.rank, numTeams),
        'starter avg': p.starterValue.toFixed(1),
        starters: p.starters.map((s) => s.name).join(', ') || '-',
        'best surplus': p.surplus[0]?.name ?? '-'
      };
    })
  );

  const { complementary, upgradeOnly, nearMisses } = findComplementaryTrades({
    myTeamId: myTeam.id,
    teamStrengths: strength,
    teamNames
  });

  function formatTradeRow(t) {
    const fit = t.tier === 'complementary' ? 'mutual need' : t.tier === 'upgrade-only' ? 'upgrade only' : 'near miss';
    return {
      fit,
      'trade with': t.withTeamName,
      'you give': `${t.give.player.name} (${t.give.position}, ${t.give.player.seasonAverage.toFixed(1)} avg)`,
      'you get': `${t.get.player.name} (${t.get.position}, ${t.get.player.seasonAverage.toFixed(1)} avg)`,
      'proj upgrade': `+${t.upgrade.toFixed(1)}`
    };
  }

  console.log('\n--- Suggested trades ---\n');
  if (complementary.length === 0 && upgradeOnly.length === 0) {
    console.log('No clear trade upgrades found this week given current position strength across the league.\n');
  } else {
    console.table([...complementary, ...upgradeOnly].slice(0, 10).map(formatTradeRow));
    console.log(
      '"mutual need" = they\'re also weak where you\'re strong (likely to say yes).' +
        ' "upgrade only" = they have the depth to spare it, but may not want your side as much — expect to negotiate.\n'
    );
  }

  if (nearMisses.length > 0) {
    console.log('--- Near-miss trades (real upgrade, but value gap is too wide to be realistic) ---\n');
    console.table(nearMisses.slice(0, 5).map(formatTradeRow));
    console.log('Worth a speculative offer, or a sense of how big a throw-in you\'d need to add to make it work.\n');
  }

  const handcuffs = findHandcuffOpportunities({ teams: teamsWithNames, myTeamId: myTeam.id });
  console.log('--- Handcuff trade chips (RB) ---\n');
  if (handcuffs.length === 0) {
    console.log('None of your RBs are a clear handcuff to another team\'s starter right now.\n');
  } else {
    console.table(
      handcuffs.map((h) => ({
        'your player': h.myPlayer.name,
        'backs up': h.starter.name,
        'starter owned by': h.starterOwnerTeamName,
        note: 'Worth offering — mostly insurance value to them, replaceable depth to you.'
      }))
    );
  }

  const gaps = computeValueGaps({ teams: teamsWithNames });
  const sellHigh = gaps
    .filter((g) => g.teamId === myTeam.id && g.gap >= 10)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 5);
  const buyLowAll = gaps.filter((g) => g.teamId !== myTeam.id && g.gap <= -10).sort((a, b) => a.gap - b.gap);
  const buyLow = buyLowAll.slice(0, 5);

  console.log('--- Sell high (yours, outperforming their draft slot) ---\n');
  if (sellHigh.length === 0) {
    console.log('Nobody on your roster is meaningfully outperforming their preseason expectation right now.\n');
  } else {
    console.table(
      sellHigh.map((g) => ({
        name: g.name,
        position: g.position,
        'preseason rank': g.preseasonRank,
        'current rank': g.currentRank,
        gap: `+${g.gap}`
      }))
    );
  }

  console.log('--- Buy low (others, underperforming their draft slot) ---\n');
  if (buyLow.length === 0) {
    console.log('No notable underperforming players elsewhere in the league right now.\n');
  } else {
    console.table(
      buyLow.map((g) => ({
        name: g.name,
        position: g.position,
        'owned by': g.teamName,
        'preseason rank': g.preseasonRank,
        'current rank': g.currentRank,
        gap: g.gap
      }))
    );
  }

  const lookaheadWeeks = buildLookaheadWeeks(scoringPeriodId);
  const getOpponentRanksForWeeks = await loadMultiWeekMatchupLookup({
    seasonId: config.seasonId,
    scoringPeriodIds: lookaheadWeeks
  });

  console.log(
    `\n--- Watch List: Possible Future Buy Low's (weeks ${lookaheadWeeks[0]}-${lookaheadWeeks[lookaheadWeeks.length - 1]}) ---\n`
  );
  console.log(
    'Top players elsewhere in the league (top 20 RB/WR, top 10 QB, top 5 TE by season average) heading into' +
      ' 2+ matchups against a top-10 defense in the next 3 weeks. Their current owner may not have priced that' +
      ' in yet — watch for a buy-low window to open before it shows up in their actual production.\n'
  );

  const watchList = findToughScheduleWatchList({
    teams: teamsWithNames,
    myTeamId: myTeam.id,
    getOpponentRanksForWeeks,
    startWeek: scoringPeriodId
  });

  if (watchList.length === 0) {
    console.log('No top-tier players elsewhere are heading into a tough matchup stretch right now.\n');
  } else {
    console.table(
      watchList.slice(0, 15).map((w) => ({
        name: w.player.name,
        position: w.player.position,
        'owned by': w.player.teamName,
        'season avg': w.player.seasonAverage.toFixed(1),
        'tough matchups': `${w.toughCount} of ${lookaheadWeeks.length}`,
        upcoming: w.matchups.map((m) => `wk${m.week}: ${m.rank ?? '-'}`).join(', ')
      }))
    );
  }

  const strongBuyLow = findBuyLowWithFavorableSchedule({
    buyLowCandidates: buyLowAll,
    getOpponentRanksForWeeks,
    startWeek: scoringPeriodId
  });

  console.log('\n--- High-confidence buy lows (already down, schedule about to help) ---\n');
  if (strongBuyLow.length === 0) {
    console.log("None of the current buy-low candidates also have a favorable upcoming schedule.\n");
  } else {
    console.table(
      strongBuyLow.map((g) => ({
        name: g.name,
        position: g.position,
        'owned by': g.teamName,
        gap: g.gap,
        'easy matchups': `${g.easyCount} of ${lookaheadWeeks.length}`,
        upcoming: g.matchups.map((m) => `wk${m.week}: ${m.rank ?? '-'}`).join(', ')
      }))
    );
  }
}

main().catch((error) => {
  console.error('Failed to build trade recommendations:', error.message);
  process.exit(1);
});
