const { createClient } = require('../espnClient');
const { getMyTeamId, getAllTeams } = require('../myTeam');
const { getAllTeamRosters } = require('../roster');
const { computeTeamPositionStrength, categorizeStrength, TRADE_POSITIONS } = require('../positionStrength');
const { loadTradeValues, ATTRIBUTION_URL } = require('../fantasyCalc');
const {
  attachTradeValues,
  computeLineupValue,
  findValueTrades,
  FAIR_TOLERANCE,
  MAX_LINEUP_LOSS
} = require('../tradeEngine');
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
  const args = { week: null, team: null, give: [], get: [] };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'week') args.week = Number(value);
    if (key === 'team') args.team = value;
    if (key === 'give') args.give = value.split(',').map((s) => s.trim()).filter(Boolean);
    if (key === 'get') args.get = value.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return args;
}

// Each --get entry is a case-insensitive substring of a player's name on
// another team, e.g. --get=chase,burrow.
function resolveTargetPlayers(getArgs, otherRosters) {
  const candidates = otherRosters.flatMap((r) =>
    r.roster.filter((p) => TRADE_POSITIONS.includes(p.position) && p.tradeValue > 0)
  );
  return getArgs.map((needle) => {
    const matches = candidates.filter((p) => p.name.toLowerCase().includes(needle.toLowerCase()));
    if (matches.length !== 1) {
      const detail =
        matches.length === 0 ? 'no player on another team' : `${matches.length} players: ${matches.map((p) => p.name).join(', ')}`;
      throw new Error(`--get "${needle}" matched ${detail}. Use more of the name.`);
    }
    return matches[0];
  });
}

// Each --give entry is a case-insensitive substring of one of my players'
// names, e.g. --give=pollard,addison.
function resolveGivePlayers(giveArgs, myRoster) {
  return giveArgs.map((needle) => {
    const matches = myRoster.filter((p) => p.tradeValue > 0 && p.name.toLowerCase().includes(needle.toLowerCase()));
    if (matches.length !== 1) {
      const options = myRoster.filter((p) => p.tradeValue > 0).map((p) => p.name).join(', ');
      throw new Error(
        `--give "${needle}" matched ${matches.length === 0 ? 'none' : 'more than one'} of your valued players. Options: ${options}`
      );
    }
    return matches[0];
  });
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

  const [rawRosters, { byEspnId }] = await Promise.all([
    getAllTeamRosters({ seasonId: config.seasonId, scoringPeriodId }),
    loadTradeValues(config.seasonId)
  ]);
  const rosters = attachTradeValues(rawRosters, byEspnId);
  const teamsWithNames = rosters.map((r) => ({ ...r, teamName: teamNames.get(r.teamId) }));
  const lineupPositionCount = league.rosterSettings.lineupPositionCount;

  const strength = computeTeamPositionStrength({ teams: rosters, lineupPositionCount });
  const numTeams = strength.size;
  const selectedTeamId = resolveTeamId(args.team, teamNames) ?? myTeam.id;
  const selected = strength.get(selectedTeamId);

  console.log(`\nTrade Recommendations for ${myTeam.name} — ${league.name}\n`);
  console.log(
    'Player values are FantasyCalc redraft (rest-of-season) trade values for this league\'s format.' +
      ` Trade values from FantasyCalc.com (${ATTRIBUTION_URL}). K/D-ST aren't valued and are excluded.\n`
  );

  const givePlayers = resolveGivePlayers(args.give, rosters.find((r) => r.teamId === myTeam.id).roster);
  const targetPlayers = resolveTargetPlayers(
    args.get,
    rosters.filter((r) => r.teamId !== myTeam.id)
  );
  const { trades, nearMisses } = findValueTrades({
    myTeamId: myTeam.id,
    teams: rosters,
    lineupPositionCount,
    teamNames,
    givePlayerIds: givePlayers.map((p) => p.id),
    targetPlayerIds: targetPlayers.map((p) => p.id)
  });

  function formatPackage(players) {
    return players.map((p) => `${p.name} (${p.position}, ${Math.round(p.tradeValue)})`).join(' + ');
  }

  const FIT_LABEL = { mutual: 'both improve', 'fair-value': 'even value', 'long-shot': 'long shot' };

  function formatTradeRow(t) {
    return {
      fit: FIT_LABEL[t.tier],
      'trade with': t.withTeamName,
      'you give': formatPackage(t.give),
      'you get': formatPackage(t.get),
      'value edge': `${t.gap >= 0 ? 'you' : 'them'} +${Math.round(Math.abs(t.gap))} (${Math.round(t.gapShare * 100)}%)`,
      'your team': `${Math.round(t.myGain) > 0 ? '+' : ''}${Math.round(t.myGain)}`,
      'their team': `${Math.round(t.partnerGain) > 0 ? '+' : ''}${Math.round(t.partnerGain)}`
    };
  }

  console.log('--- Suggested trades ---\n');
  const selection = [
    givePlayers.length > 0 ? `Giving: ${givePlayers.map((p) => p.name).join(', ')}.` : '',
    targetPlayers.length > 0 ? `Targeting: ${targetPlayers.map((p) => p.name).join(', ')}.` : ''
  ]
    .filter(Boolean)
    .join(' ');
  if (selection) {
    console.log(
      `${selection} Trades only need to keep your team value within ${MAX_LINEUP_LOSS} of where it is now, rather than improve it.\n`
    );
  }
  if (trades.length === 0) {
    console.log(
      selection
        ? 'No fair-value trades found for that selection. Try adding or removing players.\n'
        : 'No fair-value trades found that improve your starting lineup right now.\n'
    );
  } else {
    console.table((targetPlayers.length > 0 ? trades : trades.slice(0, 10)).map(formatTradeRow));
    console.log(
      `Every suggestion is within ${Math.round(FAIR_TOLERANCE * 100)}% on market value. "your team" / "their team"` +
        ' = change in each team\'s best starting lineup value plus partial credit for its top two healthy bench' +
        ' RB/WR/TE (50% and 25%). "both improve" = it fills a hole for them' +
        ' too, so they\'re most likely to accept.' +
        (targetPlayers.length > 0
          ? ` "long shot" = a fair price for your target, but it costs their team more than ${MAX_LINEUP_LOSS}.`
          : '') +
        '\n'
    );
  }

  if (nearMisses.length > 0) {
    console.log('--- Near-miss trades (passes the team checks, but values are 10-20% apart) ---\n');
    console.table(nearMisses.slice(0, 5).map(formatTradeRow));
    console.log(
      'Overpays ("them +") are listed first: they can be sent as-is. If "you" have the edge, expect to add a throw-in.\n'
    );
  }

  const me = rosters.find((r) => r.teamId === myTeam.id);
  const myLineup = computeLineupValue(me.roster, lineupPositionCount);
  console.log(`--- Your trade values (best-lineup value: ${Math.round(myLineup.total)}) ---\n`);
  console.table(
    me.roster
      .filter((p) => TRADE_POSITIONS.includes(p.position))
      .sort((a, b) => b.tradeValue - a.tradeValue)
      .map((p) => ({
        name: p.name,
        position: p.position,
        value: p.tradeValueInfo ? Math.round(p.tradeValueInfo.value) : 'not valued',
        'pos rank': p.tradeValueInfo ? `${p.position}${p.tradeValueInfo.positionRank}` : '-',
        '30-day': p.tradeValueInfo?.trend30Day ?? '-',
        role: myLineup.starterIds.has(p.id) ? 'starter' : 'bench'
      }))
  );

  console.log('\n--- League position strength by trade value (rank of ' + numTeams + ', 1 = strongest) ---\n');
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
        'starter value': Math.round(p.starterValue),
        starters: p.starters.map((s) => s.name).join(', ') || '-',
        'best surplus': p.surplus[0]?.name ?? '-'
      };
    })
  );
  console.log('');

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
