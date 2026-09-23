const { createClient } = require('../../espnClient');
const { getMyTeamId } = require('../../myTeam');
const { getRosterForTeam, getAllTeamRosters, BENCH_SLOT, IR_SLOT, slotIdToPosition } = require('../../roster');
const { loadMatchupLookup } = require('../../matchups');
const { proTeamIdToAbbreviation } = require('../../positions');
const { computeStarterPositionStrength, STARTER_STRENGTH_POSITIONS, DEFAULT_METRIC } = require('../../starterStrength');
const { categorizeStrength, strengthThird } = require('../../positionStrength');
const config = require('../../config');
const { renderLayout, escapeHtml, oprkClass } = require('../layout');

const CATEGORY_CLASS = { STRONG: 'oprk-easy', WEAK: 'oprk-tough', AVERAGE: '' };

const METRIC_OPTIONS = [
  { value: 'proj', label: 'By Projected Points' },
  { value: 'avg', label: 'Average Points' },
  { value: 'total', label: 'Total Points' }
];
const METRIC_COLUMN_LABEL = { proj: 'Starter Proj', avg: 'Starter Avg', total: 'Starter Total' };

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

async function renderTeamPage({ week, metric } = {}) {
  const client = createClient();
  const [league, myTeam] = await Promise.all([client.getLeagueInfo({ seasonId: config.seasonId }), getMyTeamId()]);
  const scoringPeriodId = week ?? league.currentScoringPeriodId;
  const selectedMetric = METRIC_OPTIONS.some((m) => m.value === metric) ? metric : DEFAULT_METRIC;

  const [roster, getOpponentRank, allRosters] = await Promise.all([
    getRosterForTeam({ seasonId: config.seasonId, scoringPeriodId, teamId: myTeam.id }),
    loadMatchupLookup({ seasonId: config.seasonId, scoringPeriodId }),
    getAllTeamRosters({ seasonId: config.seasonId, scoringPeriodId })
  ]);

  const starterStrength = computeStarterPositionStrength({ teams: allRosters, metric: selectedMetric });
  const numTeams = starterStrength.size;
  const myStarterStrength = starterStrength.get(myTeam.id);
  const strengthThirdCount = strengthThird(numTeams);

  const starterStrengthRows = STARTER_STRENGTH_POSITIONS.map((pos) => {
    const p = myStarterStrength.positions[pos];
    const category = categorizeStrength(p.rank, numTeams);
    return `<tr>
      <td>${pos}</td>
      <td>${p.rank} of ${numTeams}</td>
      <td><span class="${CATEGORY_CLASS[category]}">${category}</span></td>
      <td>${p.starterValue.toFixed(1)}</td>
      <td>${escapeHtml(p.starters.map((s) => s.name).join(', ') || '-')}</td>
    </tr>`;
  }).join('');

  const metricOptionsHtml = METRIC_OPTIONS.map(
    (m) => `<option value="${m.value}"${m.value === selectedMetric ? ' selected' : ''}>${escapeHtml(m.label)}</option>`
  ).join('');

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

    <div class="card">
      <h2>My Starters Position Strength</h2>
      <p class="muted">
        Rank of ${numTeams} at each position, using only your actual starters for Week ${scoringPeriodId}
        (bench and IR excluded), compared against the rest of the league's starters the same way. FLEX gets its
        own row — whoever's in that RB/WR/TE-eligible slot, compared against every other team's FLEX starter.
        "Average Points" is per game, backed out from each player's games played. 1 = strongest.
      </p>
      <details style="margin-bottom:12px;">
        <summary style="cursor:pointer; color:#a9b1bd;">What counts as STRONG / AVERAGE / WEAK?</summary>
        <p class="muted" style="margin-top:8px;">
          <span class="${CATEGORY_CLASS.STRONG}">STRONG</span>: top third of the league by rank<br/>
          <span class="${CATEGORY_CLASS.AVERAGE}">AVERAGE</span>: middle third<br/>
          <span class="${CATEGORY_CLASS.WEAK}">WEAK</span>: bottom third
        </p>
        <p class="muted">
          A third is rounded to the nearest whole team (minimum 1), so with ${numTeams} teams that's rank
          ${strengthThirdCount} or better for STRONG, rank ${numTeams - strengthThirdCount + 1} or worse for WEAK,
          and ranks ${strengthThirdCount + 1}-${numTeams - strengthThirdCount} in between for AVERAGE. Same
          thresholds used on the Trade Recommendations page.
        </p>
      </details>
      <form class="filters" method="get" action="/team">
        <label>Sort By
          <select name="metric">${metricOptionsHtml}</select>
        </label>
        <input type="hidden" name="week" value="${scoringPeriodId}" />
        <button type="submit">Update</button>
      </form>
      <table>
        <thead>
          <tr><th>Position</th><th>Rank</th><th>Category</th><th>${METRIC_COLUMN_LABEL[selectedMetric]}</th><th>Starters</th></tr>
        </thead>
        <tbody>${starterStrengthRows}</tbody>
      </table>
    </div>
  `;

  return renderLayout({ title: 'My Team', activePath: '/team', body });
}

module.exports = { renderTeamPage };
