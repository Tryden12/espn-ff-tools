const { createClient } = require('../../espnClient');
const { getMyTeamId } = require('../../myTeam');
const { getRosterForTeam, BENCH_SLOT, IR_SLOT, slotIdToPosition } = require('../../roster');
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

async function renderTeamPage({ week } = {}) {
  const client = createClient();
  const [league, myTeam] = await Promise.all([client.getLeagueInfo({ seasonId: config.seasonId }), getMyTeamId()]);
  const scoringPeriodId = week ?? league.currentScoringPeriodId;

  const [roster, getOpponentRank] = await Promise.all([
    getRosterForTeam({ seasonId: config.seasonId, scoringPeriodId, teamId: myTeam.id }),
    loadMatchupLookup({ seasonId: config.seasonId, scoringPeriodId })
  ]);

  const sorted = [...roster].sort((a, b) => slotSortKey(a.lineupSlotId) - slotSortKey(b.lineupSlotId));

  const rows = sorted
    .map((p) => {
      const isBenchOrIR = p.lineupSlotId === BENCH_SLOT || p.lineupSlotId === IR_SLOT;
      return `<tr${isBenchOrIR ? ' style="opacity:0.75"' : ''}>
        <td>${escapeHtml(slotIdToPosition[p.lineupSlotId] ?? p.lineupSlotId)}</td>
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.position)}</td>
        <td>${escapeHtml(p.proTeam)}</td>
        <td>${renderOprkCell(p, getOpponentRank)}</td>
        <td>${p.isInjured ? `<span class="pill">${escapeHtml(p.injuryStatus)}</span>` : '-'}</td>
        <td>${p.isLocked ? '<span class="pill">locked</span>' : '-'}</td>
        <td>${p.projected.toFixed(1)}</td>
      </tr>`;
    })
    .join('');

  const weekOptions = Array.from({ length: 18 }, (_, i) => i + 1)
    .map((w) => `<option value="${w}"${w === scoringPeriodId ? ' selected' : ''}>${w}</option>`)
    .join('');

  const body = `
    <div class="card">
      <h2>${escapeHtml(myTeam.name)}</h2>
      <p class="muted">OPRK: defense rank against the position, 1 = toughest matchup, 32 = easiest.</p>
      <form class="filters" method="get" action="/team">
        <label>Week
          <select name="week">${weekOptions}</select>
        </label>
        <button type="submit">Update</button>
      </form>
      <table>
        <thead>
          <tr>
            <th>Slot</th><th>Name</th><th>Pos</th><th>Team</th><th>OPRK</th><th>Injury</th><th>Locked</th><th>Proj Pts</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  return renderLayout({ title: 'My Team', activePath: '/team', body });
}

module.exports = { renderTeamPage };
