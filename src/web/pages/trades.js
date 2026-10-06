const { createClient } = require('../../espnClient');
const { getMyTeamId, getAllTeams } = require('../../myTeam');
const { getAllTeamRosters } = require('../../roster');
const { computeTeamPositionStrength, categorizeStrength, TRADE_POSITIONS } = require('../../positionStrength');
const { loadTradeValues } = require('../../fantasyCalc');
const {
  attachTradeValues,
  computeLineupValue,
  findValueTrades,
  FAIR_TOLERANCE,
  NEAR_MISS_TOLERANCE,
  MAX_LINEUP_LOSS
} = require('../../tradeEngine');
const { findHandcuffOpportunities } = require('../../handcuffs');
const { computeValueGaps } = require('../../valueGaps');
const { loadMultiWeekMatchupLookup } = require('../../matchups');
const {
  findToughScheduleWatchList,
  findBuyLowWithFavorableSchedule,
  buildLookaheadWeeks
} = require('../../scheduleWatch');
const config = require('../../config');
const { renderLayout, escapeHtml, oprkClass, fantasyCalcAttribution } = require('../layout');

const CATEGORY_CLASS = { STRONG: 'oprk-easy', WEAK: 'oprk-tough', AVERAGE: '' };
const TRADE_CHIP_MIN_VALUE = 1000;

function formatUpcoming(matchups) {
  return matchups.map((m) => `wk${m.week}: <span class="${oprkClass(m.rank)}">${m.rank ?? '-'}</span>`).join(', ');
}

function formatValue(value) {
  return Math.round(value).toLocaleString('en-US');
}

function formatSigned(value) {
  const rounded = Math.round(value);
  if (rounded === 0) return '0';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toLocaleString('en-US')}`;
}

function gainClass(value) {
  const rounded = Math.round(value);
  if (rounded > 0) return 'oprk-easy';
  if (rounded < 0) return 'oprk-tough';
  return '';
}

function formatTrend(trend) {
  if (!trend) return '-';
  return `<span class="${trend > 0 ? 'oprk-easy' : 'oprk-tough'}">${formatSigned(trend)}</span>`;
}

function formatPackage(players) {
  return players
    .map((p) => `${escapeHtml(p.name)} <span class="muted">(${p.position}, ${formatValue(p.tradeValue)})</span>`)
    .join('<br/>');
}

// Positive gap = I receive more value than I give.
function formatGap(trade) {
  if (Math.round(trade.gap) === 0) return 'even';
  const pct = `${Math.round(trade.gapShare * 100)}%`;
  return `${trade.gap > 0 ? 'you' : 'them'} +${formatValue(Math.abs(trade.gap))} <span class="muted">(${pct})</span>`;
}

async function renderTradesPage({ week, team, give = [], target = [], targetSearch } = {}) {
  const client = createClient();
  const [league, myTeam, allTeams] = await Promise.all([
    client.getLeagueInfo({ seasonId: config.seasonId }),
    getMyTeamId(),
    getAllTeams()
  ]);
  const scoringPeriodId = week ?? league.currentScoringPeriodId;
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
  const my = strength.get(myTeam.id);

  // Suggested trades / handcuffs / buy-sell are always from my own team's
  // perspective (they're actionable recommendations for me), but the
  // position-strength detail table below can show any team's breakdown —
  // useful for scouting a specific trade partner before reaching out.
  const selectedTeamId = team ?? myTeam.id;
  const selectedTeam = strength.get(selectedTeamId) ?? my;
  const selectedTeamName = teamNames.get(selectedTeamId) ?? myTeam.name;

  const strengthRows = TRADE_POSITIONS.map((pos) => {
    const p = selectedTeam.positions[pos];
    const category = categorizeStrength(p.rank, numTeams);
    return `<tr>
      <td>${pos}</td>
      <td>${p.rank} of ${numTeams}</td>
      <td><span class="${CATEGORY_CLASS[category]}">${category}</span></td>
      <td>${formatValue(p.starterValue)}</td>
      <td>${escapeHtml(p.starters.map((s) => s.name).join(', ') || '-')}</td>
      <td>${p.surplus[0] && p.surplus[0].tradeValue > 0 ? `${escapeHtml(p.surplus[0].name)} (${formatValue(p.surplus[0].tradeValue)})` : '-'}</td>
    </tr>`;
  }).join('');

  // Every QB/RB/WR/TE on my roster with their market value. "Bench" here
  // means outside my best lineup by value (not my current ESPN lineup) — a
  // valuable bench player is value I'm not using, i.e. a trade chip.
  const me = rosters.find((r) => r.teamId === myTeam.id);
  const myLineup = computeLineupValue(me.roster, lineupPositionCount);
  const myValueRows = me.roster
    .filter((p) => TRADE_POSITIONS.includes(p.position))
    .sort((a, b) => b.tradeValue - a.tradeValue)
    .map((p) => {
      const info = p.tradeValueInfo;
      const isStarter = myLineup.starterIds.has(p.id);
      return `<tr${isStarter ? '' : ' style="opacity:0.75"'}>
        <td>${escapeHtml(p.name)}</td>
        <td>${p.position}</td>
        <td>${info ? formatValue(info.value) : '<span class="muted">not valued</span>'}</td>
        <td>${info ? `${p.position}${info.positionRank}` : '-'}</td>
        <td>${info ? formatTrend(info.trend30Day) : '-'}</td>
        <td>${isStarter ? 'starter' : info && info.value >= TRADE_CHIP_MIN_VALUE ? '<span class="pill boost">trade chip</span>' : 'bench'}</td>
      </tr>`;
    })
    .join('');

  // Compact league-wide overview: every team's rank/category at a glance,
  // so a good trade partner for a given position jumps out visually.
  const leagueGridRows = [...strength.values()]
    .sort((a, b) => (teamNames.get(a.teamId) ?? '').localeCompare(teamNames.get(b.teamId) ?? ''))
    .map((teamStrength) => {
      const name = teamNames.get(teamStrength.teamId) ?? `Team ${teamStrength.teamId}`;
      const cells = TRADE_POSITIONS.map((pos) => {
        const p = teamStrength.positions[pos];
        const category = categorizeStrength(p.rank, numTeams);
        return `<td style="text-align:center;"><span class="${CATEGORY_CLASS[category]}">${p.rank}</span></td>`;
      }).join('');
      const isMe = teamStrength.teamId === myTeam.id;
      return `<tr${isMe ? ' style="font-weight:600"' : ''}>
        <td>${escapeHtml(name)}${isMe ? ' (you)' : ''}</td>
        ${cells}
      </tr>`;
    })
    .join('');

  const shoppablePlayers = me.roster
    .filter((p) => TRADE_POSITIONS.includes(p.position) && p.tradeValue > 0)
    .sort((a, b) => b.tradeValue - a.tradeValue);
  const selectedGiveIds = give.filter((id) => shoppablePlayers.some((p) => p.id === id));
  const selectedGiveSet = new Set(selectedGiveIds);
  const isShopping = selectedGiveIds.length > 0;

  // Every valued QB/RB/WR/TE on other teams, searchable by "Name (POS, Team)".
  const targetablePlayers = rosters
    .filter((r) => r.teamId !== myTeam.id)
    .flatMap((r) =>
      r.roster
        .filter((p) => TRADE_POSITIONS.includes(p.position) && p.tradeValue > 0)
        .map((p) => ({ ...p, ownerName: teamNames.get(r.teamId) ?? `Team ${r.teamId}` }))
    )
    .sort((a, b) => b.tradeValue - a.tradeValue);
  const targetLabel = (p) => `${p.name} (${p.position}, ${p.ownerName})`;

  // The search box submits free text; resolve it to a player by exact label,
  // then by a unique name substring.
  let targetSearchError = null;
  const requestedTargetIds = [...target];
  const searchText = (targetSearch ?? '').trim().toLowerCase();
  if (searchText) {
    const exact = targetablePlayers.find((p) => targetLabel(p).toLowerCase() === searchText);
    const partial = targetablePlayers.filter((p) => p.name.toLowerCase().includes(searchText));
    const match = exact ?? (partial.length === 1 ? partial[0] : null);
    if (match) {
      requestedTargetIds.push(match.id);
    } else {
      targetSearchError =
        partial.length > 1
          ? `"${targetSearch}" matches ${partial.length} players. Pick one from the suggestions.`
          : `No player on another team matches "${targetSearch}".`;
    }
  }
  const selectedTargets = targetablePlayers.filter((p) => requestedTargetIds.includes(p.id));
  const selectedTargetIds = selectedTargets.map((p) => p.id);
  const isTargeting = selectedTargetIds.length > 0;

  const selectionHiddenInputs = [
    ...selectedGiveIds.map((id) => `<input type="hidden" name="give" value="${id}" />`),
    ...selectedTargetIds.map((id) => `<input type="hidden" name="target" value="${id}" />`)
  ].join('');

  function tradesUrl({ giveIds = selectedGiveIds, targetIds = selectedTargetIds } = {}) {
    const params = new URLSearchParams({ week: String(scoringPeriodId) });
    if (team) params.set('team', String(team));
    giveIds.forEach((id) => params.append('give', String(id)));
    targetIds.forEach((id) => params.append('target', String(id)));
    return `/trades?${params}`;
  }

  const { trades, nearMisses } = findValueTrades({
    myTeamId: myTeam.id,
    teams: rosters,
    lineupPositionCount,
    teamNames,
    givePlayerIds: selectedGiveIds,
    targetPlayerIds: selectedTargetIds
  });

  const shopCheckboxes = shoppablePlayers
    .map(
      (p) => `<label style="display:flex; align-items:center; gap:6px; font-size:13px; color:#e6e6e6; white-space:nowrap;">
        <input type="checkbox" name="give" value="${p.id}"${selectedGiveSet.has(p.id) ? ' checked' : ''} />
        ${escapeHtml(p.name)} <span class="muted">(${p.position}, ${formatValue(p.tradeValue)})</span>
      </label>`
    )
    .join('');

  const targetChips = selectedTargets
    .map(
      (p) => `<span class="pill" style="display:inline-flex; align-items:center; gap:6px; padding:4px 10px; font-size:13px;">
        ${escapeHtml(p.name)} <span class="muted">(${p.position}, ${escapeHtml(p.ownerName)}, ${formatValue(p.tradeValue)})</span>
        <a href="${escapeHtml(tradesUrl({ targetIds: selectedTargetIds.filter((id) => id !== p.id) }))}" title="Remove" style="text-decoration:none;">×</a>
      </span>`
    )
    .join('');

  const targetOptions = targetablePlayers
    .filter((p) => !selectedTargetIds.includes(p.id))
    .map((p) => `<option value="${escapeHtml(targetLabel(p))}">${formatValue(p.tradeValue)}</option>`)
    .join('');

  const shopFormHtml = `
    <form method="get" action="/trades" style="margin-bottom:16px;">
      <h3 style="margin:0 0 4px;">You give</h3>
      <p class="muted" style="margin-top:0;">
        Tick who you're willing to trade away, and only offers built around them are shown (1-for-1 or 1-for-2 for
        each, or 2-for-1 if you pick two or more). Leave everything unticked to consider your whole roster.
      </p>
      <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:6px 16px; margin-bottom:16px;">
        ${shopCheckboxes}
      </div>
      <h3 style="margin:0 0 4px;">You want</h3>
      <p class="muted" style="margin-top:0;">
        Search for players on other teams you'd like to land. Every offer will bring back at least one of them, on
        its own or with a second player from the same team. Leave empty to search every team for lineup upgrades.
      </p>
      ${targetChips ? `<div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:8px;">${targetChips}</div>` : ''}
      ${selectedTargetIds.map((id) => `<input type="hidden" name="target" value="${id}" />`).join('')}
      <input type="text" name="targetSearch" list="target-players" placeholder="Search players on other teams…" autocomplete="off"
        style="background:#0f1115; color:#e6e6e6; border:1px solid #333a45; border-radius:6px; padding:8px 10px; width:100%; max-width:420px; box-sizing:border-box;" />
      <datalist id="target-players">${targetOptions}</datalist>
      ${targetSearchError ? `<p class="oprk-tough" style="margin:6px 0 0;">${escapeHtml(targetSearchError)}</p>` : ''}
      <input type="hidden" name="week" value="${scoringPeriodId}" />
      ${team ? `<input type="hidden" name="team" value="${team}" />` : ''}
      <div style="display:flex; gap:12px; align-items:center; margin-top:16px;">
        <button type="submit" style="background:#2f6fed; color:#fff; border:none; border-radius:6px; padding:8px 16px; cursor:pointer;">Find Trades</button>
        ${isShopping || isTargeting ? `<a href="${escapeHtml(tradesUrl({ giveIds: [], targetIds: [] }))}">Clear selection</a>` : ''}
      </div>
    </form>`;

  const FIT_PILL = {
    mutual: '<span class="pill boost">both teams improve</span>',
    'fair-value': '<span class="pill">even value</span>',
    'long-shot': '<span class="pill" style="background:#4a1f24; color:#ffb4bc;">long shot</span>'
  };

  function tradeTable(rows) {
    return `<table>
        <thead><tr><th>Fit</th><th>Trade With</th><th>You Give</th><th>You Get</th><th>Value Edge</th><th>Your Team</th><th>Their Team</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (t) => `<tr>
            <td>${FIT_PILL[t.tier]}</td>
            <td>${escapeHtml(t.withTeamName)}</td>
            <td>${formatPackage(t.give)}</td>
            <td>${formatPackage(t.get)}</td>
            <td>${formatGap(t)}</td>
            <td><span class="${gainClass(t.myGain)}">${formatSigned(t.myGain)}</span></td>
            <td><span class="${gainClass(t.partnerGain)}">${formatSigned(t.partnerGain)}</span></td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>`;
  }

  const shoppingNames = shoppablePlayers.filter((p) => selectedGiveSet.has(p.id)).map((p) => p.name);
  const targetNames = selectedTargets.map((p) => p.name);
  const selectionSummary = [
    isShopping ? `<strong>Giving:</strong> ${escapeHtml(shoppingNames.join(', '))}.` : '',
    isTargeting ? `<strong>Targeting:</strong> ${escapeHtml(targetNames.join(', '))}.` : ''
  ]
    .filter(Boolean)
    .join(' ');

  let emptyTradesMessage = '<p>No fair-value trades found that improve your starting lineup right now.</p>';
  if (isTargeting) {
    emptyTradesMessage = `<p>No offer${isShopping ? ' from the players you ticked' : ''} comes within ${Math.round(NEAR_MISS_TOLERANCE * 100)}% of the value of ${escapeHtml(targetNames.join(', '))} without costing your team more than ${formatValue(MAX_LINEUP_LOSS)}.${isShopping ? ' Try ticking more players, or none to consider your whole roster.' : ''}</p>`;
  } else if (isShopping) {
    emptyTradesMessage = `<p>No fair-value trades found for ${escapeHtml(shoppingNames.join(', '))} that don't cost your team more than ${formatValue(MAX_LINEUP_LOSS)} in value. Try adding another player to pair with them.</p>`;
  }

  const tradesHtml =
    shopFormHtml +
    (selectionSummary
      ? `<p>${selectionSummary} Trades here only need to keep your team value within ${formatValue(MAX_LINEUP_LOSS)} of where it is now, rather than improve it.</p>`
      : '') +
    (trades.length === 0
      ? emptyTradesMessage
      : `${tradeTable(isTargeting ? trades : trades.slice(0, 10))}
      <p class="muted">
        Every suggestion is within ${Math.round(FAIR_TOLERANCE * 100)}% on FantasyCalc market value, so it isn't a
        lowball. "Value Edge" = which side comes out ahead on total value, and by how much. "Your Team" / "Their
        Team" = change in each team's best starting lineup value, plus partial credit for its top two healthy bench
        RB/WR/TE (50% and 25%), since depth covers byes and injuries. The trade works by turning value stuck on one
        bench into starter quality or depth where the other team is thin.
        <span class="pill boost">both teams improve</span> = it fills a hole for them too, so they're most likely
        to accept. <span class="pill">even value</span> = fair on paper and doesn't hurt their starters much, but
        less of a clear win for them.${isTargeting ? ` <span class="pill" style="background:#4a1f24; color:#ffb4bc;">long shot</span> = a fair price for your target, but it costs their team more than ${formatValue(MAX_LINEUP_LOSS)}, so expect a no unless they're deep enough to absorb it.` : ''}
        In a 2-for-1, the side getting two players will need to drop someone.
      </p>`) +
    (nearMisses.length === 0
      ? ''
      : `
      <h3 style="margin-top:24px;">Near-Miss Trades</h3>
      <p class="muted">
        Passes the team checks, but the values are ${Math.round(FAIR_TOLERANCE * 100)}-${Math.round(NEAR_MISS_TOLERANCE * 100)}%
        apart. Overpays ("them +") are listed first: they can be sent as-is, so decide whether the gain is worth the
        extra value. If you'd get more ("you +"), expect to add a throw-in.
      </p>
      ${tradeTable(nearMisses.slice(0, 5))}`);

  const handcuffs = findHandcuffOpportunities({ teams: teamsWithNames, myTeamId: myTeam.id });
  const handcuffsHtml =
    handcuffs.length === 0
      ? "<p>None of your RBs are a clear handcuff to another team's starter right now.</p>"
      : `
      <table>
        <thead><tr><th>Your Player</th><th>Backs Up</th><th>Starter Owned By</th></tr></thead>
        <tbody>
          ${handcuffs
            .map(
              (h) => `<tr>
            <td>${escapeHtml(h.myPlayer.name)}</td>
            <td>${escapeHtml(h.starter.name)}</td>
            <td>${escapeHtml(h.starterOwnerTeamName)}</td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>
      <p class="muted">Mostly insurance value to them, replaceable depth to you — a natural throw-in or standalone offer.</p>`;

  const gaps = computeValueGaps({ teams: teamsWithNames });
  const sellHigh = gaps
    .filter((g) => g.teamId === myTeam.id && g.gap >= 10)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 5);
  const buyLowAll = gaps.filter((g) => g.teamId !== myTeam.id && g.gap <= -10).sort((a, b) => a.gap - b.gap);
  const buyLow = buyLowAll.slice(0, 5);

  function gapTable(rows, showOwner) {
    if (rows.length === 0) return '<p>None right now.</p>';
    return `<table>
      <thead><tr><th>Name</th><th>Pos</th>${showOwner ? '<th>Owned By</th>' : ''}<th>Preseason Rank</th><th>Current Rank</th><th>Gap</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (g) => `<tr>
          <td>${escapeHtml(g.name)}</td>
          <td>${g.position}</td>
          ${showOwner ? `<td>${escapeHtml(g.teamName)}</td>` : ''}
          <td>${g.preseasonRank}</td>
          <td>${g.currentRank}</td>
          <td>${g.gap > 0 ? '+' : ''}${g.gap}</td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
  }

  const lookaheadWeeks = buildLookaheadWeeks(scoringPeriodId);
  const getOpponentRanksForWeeks = await loadMultiWeekMatchupLookup({
    seasonId: config.seasonId,
    scoringPeriodIds: lookaheadWeeks
  });

  const watchList = findToughScheduleWatchList({
    teams: teamsWithNames,
    myTeamId: myTeam.id,
    getOpponentRanksForWeeks,
    startWeek: scoringPeriodId
  });
  const watchListHtml =
    watchList.length === 0
      ? '<p>No top-tier players elsewhere are heading into a tough matchup stretch right now.</p>'
      : `<table>
        <thead><tr><th>Name</th><th>Pos</th><th>Owned By</th><th>Season Avg</th><th>Tough Matchups</th><th>Upcoming</th></tr></thead>
        <tbody>
          ${watchList
            .slice(0, 15)
            .map(
              (w) => `<tr>
            <td>${escapeHtml(w.player.name)}</td>
            <td>${w.player.position}</td>
            <td>${escapeHtml(w.player.teamName)}</td>
            <td>${w.player.seasonAverage.toFixed(1)}</td>
            <td>${w.toughCount} of ${lookaheadWeeks.length}</td>
            <td>${formatUpcoming(w.matchups)}</td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>`;

  const strongBuyLow = findBuyLowWithFavorableSchedule({
    buyLowCandidates: buyLowAll,
    getOpponentRanksForWeeks,
    startWeek: scoringPeriodId
  });
  const strongBuyLowHtml =
    strongBuyLow.length === 0
      ? '<p>None of the current buy-low candidates also have a favorable upcoming schedule.</p>'
      : `<table>
        <thead><tr><th>Name</th><th>Pos</th><th>Owned By</th><th>Gap</th><th>Easy Matchups</th><th>Upcoming</th></tr></thead>
        <tbody>
          ${strongBuyLow
            .map(
              (g) => `<tr>
            <td>${escapeHtml(g.name)}</td>
            <td>${g.position}</td>
            <td>${escapeHtml(g.teamName)}</td>
            <td>${g.gap}</td>
            <td>${g.easyCount} of ${lookaheadWeeks.length}</td>
            <td>${formatUpcoming(g.matchups)}</td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>`;

  const weekOptions = Array.from({ length: 18 }, (_, i) => i + 1)
    .map((w) => `<option value="${w}"${w === scoringPeriodId ? ' selected' : ''}>${w}</option>`)
    .join('');
  const teamOptions = [...teamNames.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, name]) => `<option value="${id}"${id === selectedTeamId ? ' selected' : ''}>${escapeHtml(name)}${id === myTeam.id ? ' (you)' : ''}</option>`)
    .join('');

  const body = `
    <div class="card">
      <h2>Trade Recommendations — ${escapeHtml(myTeam.name)}</h2>
      <p class="muted">
        Player values are FantasyCalc's redraft (rest-of-season) trade values for this league's format, derived
        from millions of real fantasy trades. They're forward-looking and not skewed by one big game the way
        season-to-date points are. K/D-ST aren't valued and are excluded.
      </p>
      ${fantasyCalcAttribution()}
      <form class="filters" method="get" action="/trades">
        <label>Week
          <select name="week">${weekOptions}</select>
        </label>
        ${team ? `<input type="hidden" name="team" value="${team}" />` : ''}
        ${selectionHiddenInputs}
        <button type="submit">Update</button>
      </form>
    </div>

    <div class="card">
      <h2>Suggested Trades</h2>
      ${tradesHtml}
      ${fantasyCalcAttribution()}
    </div>

    <div class="card">
      <h2>Your Trade Values</h2>
      <p class="muted">
        "Starter" = in your best possible lineup by value (QB, 2 RB, 2 WR, TE, FLEX), regardless of how your ESPN
        lineup is currently set. A <span class="pill boost">trade chip</span> is a bench player worth ${formatValue(TRADE_CHIP_MIN_VALUE)}+, value
        you aren't using in your lineup. 30-Day = how the player's value has moved over the last month.
      </p>
      <table>
        <thead><tr><th>Name</th><th>Pos</th><th>Value</th><th>Pos Rank</th><th>30-Day</th><th>Role</th></tr></thead>
        <tbody>${myValueRows}</tbody>
      </table>
      <p class="muted">Best-lineup value: <strong>${formatValue(myLineup.total)}</strong></p>
      ${fantasyCalcAttribution()}
    </div>

    <div class="card">
      <h2>League Position Strength</h2>
      <p class="muted">
        Rank of ${numTeams} at each position by the combined trade value of each team's starter-count best players
        there, 1 = strongest. Colored like OPRK: green = strong, red = weak.
      </p>
      <table>
        <thead>
          <tr><th>Team</th>${TRADE_POSITIONS.map((pos) => `<th style="text-align:center;">${pos}</th>`).join('')}</tr>
        </thead>
        <tbody>${leagueGridRows}</tbody>
      </table>
      ${fantasyCalcAttribution()}
    </div>

    <div class="card">
      <h2>Position Strength Detail — ${escapeHtml(selectedTeamName)}${selectedTeamId === myTeam.id ? ' (you)' : ''}</h2>
      <form class="filters" method="get" action="/trades">
        <label>Team
          <select name="team">${teamOptions}</select>
        </label>
        <input type="hidden" name="week" value="${scoringPeriodId}" />
        ${selectionHiddenInputs}
        <button type="submit">View</button>
      </form>
      <table>
        <thead>
          <tr><th>Position</th><th>Rank</th><th>Category</th><th>Starter Value</th><th>Starters</th><th>Best Surplus</th></tr>
        </thead>
        <tbody>${strengthRows}</tbody>
      </table>
      ${fantasyCalcAttribution()}
    </div>

    <div class="card">
      <h2>Handcuff Trade Chips (RB)</h2>
      ${handcuffsHtml}
    </div>

    <div class="card">
      <h2>Sell High (yours, outperforming their draft slot)</h2>
      ${gapTable(sellHigh, false)}
    </div>

    <div class="card">
      <h2>Buy Low (others, underperforming their draft slot)</h2>
      ${gapTable(buyLow, true)}
    </div>

    <div class="card">
      <h2>Watch List — Possible Future Buy Low's</h2>
      <p class="muted">
        Weeks ${lookaheadWeeks[0]}-${lookaheadWeeks[lookaheadWeeks.length - 1]}. Top players elsewhere in the
        league (top 20 RB/WR, top 10 QB, top 5 TE by season average) heading into 2+ matchups against a top-10
        defense. Their current owner may not have priced that in yet — watch for a buy-low window to open before
        it shows up in their actual production.
      </p>
      ${watchListHtml}
      <h3 style="margin-top:24px;">High-Confidence Buy Lows</h3>
      <p class="muted">Already underperforming their draft slot, and their schedule is about to get easier too.</p>
      ${strongBuyLowHtml}
    </div>
  `;

  return renderLayout({ title: 'Trade Recommendations', activePath: '/trades', body });
}

module.exports = { renderTradesPage };
