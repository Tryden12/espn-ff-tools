const { createClient } = require('../../espnClient');
const { getMyTeamId, getAllTeams } = require('../../myTeam');
const { getAllTeamRosters } = require('../../roster');
const { computeTeamPositionStrength, categorizeStrength, TRADE_POSITIONS } = require('../../positionStrength');
const { findComplementaryTrades } = require('../../tradeFinder');
const { findHandcuffOpportunities } = require('../../handcuffs');
const { computeValueGaps } = require('../../valueGaps');
const { loadMultiWeekMatchupLookup } = require('../../matchups');
const {
  findToughScheduleWatchList,
  findBuyLowWithFavorableSchedule,
  buildLookaheadWeeks
} = require('../../scheduleWatch');
const config = require('../../config');
const { renderLayout, escapeHtml, oprkClass } = require('../layout');

const CATEGORY_CLASS = { STRONG: 'oprk-easy', WEAK: 'oprk-tough', AVERAGE: '' };

function formatUpcoming(matchups) {
  return matchups.map((m) => `wk${m.week}: <span class="${oprkClass(m.rank)}">${m.rank ?? '-'}</span>`).join(', ');
}

async function renderTradesPage({ week, team } = {}) {
  const client = createClient();
  const [league, myTeam, allTeams] = await Promise.all([
    client.getLeagueInfo({ seasonId: config.seasonId }),
    getMyTeamId(),
    getAllTeams()
  ]);
  const scoringPeriodId = week ?? league.currentScoringPeriodId;
  const teamNames = new Map(allTeams.map((t) => [t.id, t.name]));

  const rosters = await getAllTeamRosters({ seasonId: config.seasonId, scoringPeriodId });
  const teamsWithNames = rosters.map((r) => ({ ...r, teamName: teamNames.get(r.teamId) }));

  const strength = computeTeamPositionStrength({
    teams: rosters,
    lineupPositionCount: league.rosterSettings.lineupPositionCount
  });
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
      <td>${p.starterValue.toFixed(1)}</td>
      <td>${escapeHtml(p.starters.map((s) => s.name).join(', ') || '-')}</td>
      <td>${escapeHtml(p.surplus[0]?.name ?? '-')}</td>
    </tr>`;
  }).join('');

  // Compact league-wide overview: every team's rank/category at a glance,
  // so a good trade partner for a given position jumps out visually.
  const leagueGridRows = [...strength.values()]
    .sort((a, b) => (teamNames.get(a.teamId) ?? '').localeCompare(teamNames.get(b.teamId) ?? ''))
    .map((teamStrength) => {
      const name = teamNames.get(teamStrength.teamId) ?? `Team ${teamStrength.teamId}`;
      const cells = TRADE_POSITIONS.map((pos) => {
        const p = teamStrength.positions[pos];
        const category = categorizeStrength(p.rank, numTeams);
        return `<td><span class="${CATEGORY_CLASS[category]}">${p.rank}</span></td>`;
      }).join('');
      const isMe = teamStrength.teamId === myTeam.id;
      return `<tr${isMe ? ' style="font-weight:600"' : ''}>
        <td>${escapeHtml(name)}${isMe ? ' (you)' : ''}</td>
        ${cells}
      </tr>`;
    })
    .join('');

  const { complementary, upgradeOnly } = findComplementaryTrades({
    myTeamId: myTeam.id,
    teamStrengths: strength,
    teamNames
  });
  const allTrades = [...complementary, ...upgradeOnly].slice(0, 10);

  const tradesHtml =
    allTrades.length === 0
      ? '<p>No clear trade upgrades found this week given current position strength across the league.</p>'
      : `
      <table>
        <thead><tr><th>Fit</th><th>Trade With</th><th>You Give</th><th>You Get</th><th>Proj Upgrade</th></tr></thead>
        <tbody>
          ${allTrades
            .map(
              (t) => `<tr>
            <td>${t.tier === 'complementary' ? '<span class="pill boost">mutual need</span>' : '<span class="pill">upgrade only</span>'}</td>
            <td>${escapeHtml(t.withTeamName)}</td>
            <td>${escapeHtml(t.give.player.name)} (${t.give.position}, ${t.give.player.seasonAverage.toFixed(1)} avg)</td>
            <td>${escapeHtml(t.get.player.name)} (${t.get.position}, ${t.get.player.seasonAverage.toFixed(1)} avg)</td>
            <td>+${t.upgrade.toFixed(1)}</td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>
      <p class="muted">
        "Mutual need" = they're also weak where you're strong (likely to say yes).
        "Upgrade only" = they have the depth to spare it, but may not want your side as much — expect to negotiate.
      </p>`;

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
        Position strength is each team's season-per-game average across their starter-count best players at that
        position — early season, so small-sample noise (one huge game) can skew it. K/D-ST excluded (rarely trade
        currency).
      </p>
      <form class="filters" method="get" action="/trades">
        <label>Week
          <select name="week">${weekOptions}</select>
        </label>
        <button type="submit">Update</button>
      </form>
    </div>

    <div class="card">
      <h2>League Position Strength</h2>
      <p class="muted">Rank of ${numTeams} at each position, 1 = strongest. Colored like OPRK: green = strong, red = weak.</p>
      <table>
        <thead>
          <tr><th>Team</th>${TRADE_POSITIONS.map((pos) => `<th>${pos}</th>`).join('')}</tr>
        </thead>
        <tbody>${leagueGridRows}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>Position Strength Detail — ${escapeHtml(selectedTeamName)}${selectedTeamId === myTeam.id ? ' (you)' : ''}</h2>
      <form class="filters" method="get" action="/trades">
        <label>Team
          <select name="team">${teamOptions}</select>
        </label>
        <input type="hidden" name="week" value="${scoringPeriodId}" />
        <button type="submit">View</button>
      </form>
      <table>
        <thead>
          <tr><th>Position</th><th>Rank</th><th>Category</th><th>Starter Avg</th><th>Starters</th><th>Best Surplus</th></tr>
        </thead>
        <tbody>${strengthRows}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>Suggested Trades</h2>
      ${tradesHtml}
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
