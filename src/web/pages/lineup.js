const { createClient } = require('../../espnClient');
const { getMyTeamId } = require('../../myTeam');
const { getRosterForTeam, BENCH_SLOT, IR_SLOT, slotIdToPosition } = require('../../roster');
const { optimizeLineup, buildChanges } = require('../../lineupOptimizer');
const { loadMatchupLookup } = require('../../matchups');
const { proTeamIdToAbbreviation } = require('../../positions');
const config = require('../../config');
const { renderLayout, escapeHtml, oprkClass } = require('../layout');

const SLOT_DISPLAY_ORDER = [0, 2, 4, 6, 23, 16, 17, 20, 21];

function slotSortKey(lineupSlotId) {
  const index = SLOT_DISPLAY_ORDER.indexOf(lineupSlotId);
  return index === -1 ? SLOT_DISPLAY_ORDER.length : index;
}

function renderOprkCell(player, getOpponentRank) {
  const matchup = getOpponentRank({ proTeamId: player.proTeamId, positionId: player.positionId });
  if (!matchup || matchup.rank === null) return '-';
  const opponentAbbrev = proTeamIdToAbbreviation[matchup.opponentProTeamId] ?? '?';
  const text = escapeHtml(`${matchup.rank} (v ${opponentAbbrev})`);
  return `<span class="${oprkClass(matchup.rank)}">${text}</span>`;
}

async function renderLineupPage({ week } = {}) {
  const client = createClient();
  const [league, myTeam] = await Promise.all([client.getLeagueInfo({ seasonId: config.seasonId }), getMyTeamId()]);
  const scoringPeriodId = week ?? league.currentScoringPeriodId;

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

  const changesHtml =
    changes.length === 0
      ? `<p>Your projected-best lineup is already set. No changes recommended.</p>`
      : `
      <p class="muted">Projected gain from these changes: <strong>+${gain.toFixed(1)} pts</strong></p>
      <table>
        <thead><tr><th>Start</th><th>OPRK</th><th>Over</th><th>OPRK</th><th>Slot</th><th>Proj Gain</th></tr></thead>
        <tbody>
          ${changes
            .map(
              ({ start, sit, slotId, gain: slotGain }) => `
            <tr>
              <td>${escapeHtml(start.name)} (${escapeHtml(start.position)}, ${escapeHtml(start.proTeam)})</td>
              <td>${renderOprkCell(start, getOpponentRank)}</td>
              <td>${escapeHtml(sit.name)} (${escapeHtml(sit.position)}, ${escapeHtml(sit.proTeam)})</td>
              <td>${renderOprkCell(sit, getOpponentRank)}</td>
              <td>${escapeHtml(slotIdToPosition[slotId] ?? slotId)}</td>
              <td>+${slotGain.toFixed(1)}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>`;

  const sorted = [...starters, ...bench].sort((a, b) => slotSortKey(a.lineupSlotId) - slotSortKey(b.lineupSlotId));
  const lineupRows = sorted
    .map(
      (p) => `<tr${p.lineupSlotId === BENCH_SLOT ? ' style="opacity:0.75"' : ''}>
        <td>${escapeHtml(slotIdToPosition[p.lineupSlotId] ?? p.lineupSlotId)}</td>
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.position)}</td>
        <td>${escapeHtml(p.proTeam)}</td>
        <td>${renderOprkCell(p, getOpponentRank)}</td>
        <td>${p.isInjured ? `<span class="pill">${escapeHtml(p.injuryStatus)}</span>` : '-'}</td>
        <td>${p.isLocked ? '<span class="pill">locked</span>' : '-'}</td>
        <td>${p.projected.toFixed(1)}</td>
      </tr>`
    )
    .join('');

  const weekOptions = Array.from({ length: 18 }, (_, i) => i + 1)
    .map((w) => `<option value="${w}"${w === scoringPeriodId ? ' selected' : ''}>${w}</option>`)
    .join('');

  const body = `
    <div class="card">
      <h2>Lineup Optimizer — ${escapeHtml(myTeam.name)}</h2>
      <p class="muted">
        Exact optimal lineup (bitmask DP over slot eligibility), not a one-swap heuristic.
        OPRK: 1 = toughest matchup, 32 = easiest.
        ${lockedCount > 0 ? `${lockedCount} player(s) already locked (game started) — their slots are fixed.` : ''}
      </p>
      <form class="filters" method="get" action="/lineup">
        <label>Week
          <select name="week">${weekOptions}</select>
        </label>
        <button type="submit">Update</button>
      </form>
      ${changesHtml}
    </div>
    <div class="card">
      <h2>Full lineup</h2>
      <table>
        <thead>
          <tr>
            <th>Slot</th><th>Name</th><th>Pos</th><th>Team</th><th>OPRK</th><th>Injury</th><th>Locked</th><th>Proj Pts</th>
          </tr>
        </thead>
        <tbody>${lineupRows}</tbody>
      </table>
    </div>
  `;

  return renderLayout({ title: 'Lineup Optimizer', activePath: '/lineup', body });
}

module.exports = { renderLineupPage };
