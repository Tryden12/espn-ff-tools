const { createClient } = require('../../espnClient');
const { getMyTeamId, getAllTeams } = require('../../myTeam');
const { getRosterForTeam, getAllTeamRosters, BENCH_SLOT, IR_SLOT, slotIdToPosition } = require('../../roster');
const { optimizeLineup, buildChanges } = require('../../lineupOptimizer');
const { getFreeAgentDetails } = require('../../freeAgents');
const { loadMatchupLookup } = require('../../matchups');
const { getLeagueWidePlayers, findOpportunityBoosts } = require('../../depthChart');
const { computeRecommendationScore } = require('../../recommendation');
const { proTeamIdToAbbreviation } = require('../../positions');
const { findAddDropSuggestions, MIN_UPGRADE } = require('../../addDropFinder');
const { computeTeamPositionStrength } = require('../../positionStrength');
const { findComplementaryTrades } = require('../../tradeFinder');
const config = require('../../config');
const { renderLayout, escapeHtml, oprkClass } = require('../layout');

function renderOprkCell(proTeamId, positionId, getOpponentRank) {
  const matchup = getOpponentRank({ proTeamId, positionId });
  if (!matchup || matchup.rank === null) return '-';
  const opponentAbbrev = proTeamIdToAbbreviation[matchup.opponentProTeamId] ?? '?';
  const text = escapeHtml(`${matchup.rank} (v ${opponentAbbrev})`);
  return `<span class="${oprkClass(matchup.rank)}">${text}</span>`;
}

async function renderCuratedPage({ week } = {}) {
  const client = createClient();
  const [league, myTeam, allTeams] = await Promise.all([
    client.getLeagueInfo({ seasonId: config.seasonId }),
    getMyTeamId(),
    getAllTeams()
  ]);
  const scoringPeriodId = week ?? league.currentScoringPeriodId;
  const teamNames = new Map(allTeams.map((t) => [t.id, t.name]));

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

  const lineupHtml =
    lineupChanges.length === 0
      ? '<p>Your lineup is already optimal — nothing to change.</p>'
      : `
      <table>
        <thead><tr><th>Start</th><th>Over</th><th>Slot</th><th>Proj Gain</th></tr></thead>
        <tbody>
          ${lineupChanges
            .map(
              ({ start, sit, slotId, gain }) => `<tr>
            <td>${escapeHtml(start.name)} (${escapeHtml(start.position)}, ${escapeHtml(start.proTeam)})</td>
            <td>${escapeHtml(sit.name)} (${escapeHtml(sit.position)}, ${escapeHtml(sit.proTeam)})</td>
            <td>${escapeHtml(slotIdToPosition[slotId] ?? slotId)}</td>
            <td>+${gain.toFixed(1)}</td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>
      <p class="muted">Total projected gain: <strong>+${lineupGain.toFixed(1)} pts</strong></p>`;

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

  function addDropTable(rows) {
    return `<table>
        <thead><tr><th>Add</th><th>OPRK</th><th>Proj</th><th>Add Season Avg</th><th>Drop</th><th>Drop Proj</th><th>Drop Season Avg</th><th>Upgrade</th></tr></thead>
        <tbody>
          ${rows
            .map(
              ({ add, drop, upgrade, isStreamStart }) => `<tr>
            <td>${escapeHtml(add.name)} (${add.position})</td>
            <td>${renderOprkCell(add.proTeamId, add.positionId, getOpponentRank)}</td>
            <td>${add.projected.toFixed(1)}</td>
            <td>${add.seasonAverage.toFixed(1)}</td>
            <td>${escapeHtml(drop.name)} (${drop.position})${isStreamStart ? ' <span class="pill">starter</span>' : ''}</td>
            <td>${drop.projected.toFixed(1)}</td>
            <td>${drop.seasonAverage.toFixed(1)}</td>
            <td>+${upgrade.toFixed(1)}</td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>`;
  }

  const waiverHtml =
    (addDrops.length === 0
      ? '<p>No waiver upgrades clear enough to bother with this week.</p>'
      : `${addDropTable(addDrops)}
      <p class="muted">
        Drop candidate = your weakest bench player at that position by season-per-game average (not just this
        week's projection), so a rough single-week matchup for an otherwise-good player doesn't get them cut.
        <span class="pill">starter</span> = no bench player at that position (common for D/ST/K/single-TE
        rosters), so this replaces your current starter directly — a streaming move, not a bench upgrade.
      </p>`) +
    (nearMisses.length === 0
      ? ''
      : `
      <h3 style="margin-top:24px;">Near Misses (real but under the +${MIN_UPGRADE.toFixed(1)} pt bar)</h3>
      ${addDropTable(nearMisses)}
      <p class="muted">Shown for your own judgment call — not clear enough upgrades to recommend outright.</p>`);

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
  // drop for a waiver upgrade — the two recommendations would contradict.
  const droppedPlayerIds = new Set(addDrops.map((d) => d.drop.id));
  const topTrades = [...complementary, ...upgradeOnly].filter((t) => !droppedPlayerIds.has(t.give.player.id)).slice(0, 2);

  const tradeHtml =
    topTrades.length === 0
      ? '<p>No clear trade upgrades found this week. See the <a href="/trades">Trade Recommendations</a> page for the full breakdown.</p>'
      : `
      <table>
        <thead><tr><th>Fit</th><th>Trade With</th><th>You Give</th><th>You Get</th><th>Proj Upgrade</th></tr></thead>
        <tbody>
          ${topTrades
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
      <p class="muted">See the <a href="/trades">Trade Recommendations</a> page for the full breakdown, watch list, and handcuff chips.</p>`;

  const weekOptions = Array.from({ length: 18 }, (_, i) => i + 1)
    .map((w) => `<option value="${w}"${w === scoringPeriodId ? ' selected' : ''}>${w}</option>`)
    .join('');

  const body = `
    <div class="card">
      <h2>Curated Suggestions — ${escapeHtml(myTeam.name)}</h2>
      <p class="muted">The top 1-2 actionable moves from each feature, combined into one digest for this week.</p>
      <form class="filters" method="get" action="/curated">
        <label>Week
          <select name="week">${weekOptions}</select>
        </label>
        <button type="submit">Update</button>
      </form>
    </div>

    <div class="card">
      <h2>1. Set Your Lineup</h2>
      ${lineupHtml}
    </div>

    <div class="card">
      <h2>2. Waiver Wire Moves</h2>
      ${waiverHtml}
    </div>

    <div class="card">
      <h2>3. Trade Ideas</h2>
      ${tradeHtml}
    </div>
  `;

  return renderLayout({ title: 'Curated Suggestions', activePath: '/curated', body });
}

module.exports = { renderCuratedPage };
