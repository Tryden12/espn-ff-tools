const { createClient } = require('../../espnClient');
const { getFreeAgentDetails } = require('../../freeAgents');
const { loadMatchupLookup } = require('../../matchups');
const { getLeagueWidePlayers, findOpportunityBoosts } = require('../../depthChart');
const { proTeamIdToAbbreviation } = require('../../positions');
const { computeRecommendationScore } = require('../../recommendation');
const config = require('../../config');
const { renderLayout, escapeHtml, oprkClass } = require('../layout');

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'D/ST', 'K'];

// Each sortable column: its query key, table header label, and how to pull
// a comparable numeric value out of a player. Shared by the dropdown, the
// clickable column headers, and the actual sort.
const SORT_COLUMNS = [
  { key: 'rank', label: 'Rank' },
  { key: 'oprk', label: 'OPRK' },
  { key: 'owned', label: '% Owned' },
  { key: 'proj', label: 'Proj Pts' },
  { key: 'rec', label: 'Rec Pts' },
  { key: 'last', label: 'Actual Pts' },
  { key: 'avg', label: 'Avg' },
  { key: 'fpts', label: 'YTD FPTS' }
];

function getOprkMatchup(detail, getOpponentRank) {
  if (!detail) return null;
  return getOpponentRank({ proTeamId: detail.proTeamId, positionId: detail.positionId });
}

function renderOprkCell(detail, getOpponentRank) {
  const matchup = getOprkMatchup(detail, getOpponentRank);
  if (!matchup || matchup.rank === null) return '-';
  const opponentAbbrev = proTeamIdToAbbreviation[matchup.opponentProTeamId] ?? '?';
  const text = escapeHtml(`${matchup.rank} (v ${opponentAbbrev})`);
  return `<span class="${oprkClass(matchup.rank)}">${text}</span>`;
}

function getRecommendationScore(player, details, getOpponentRank, opportunityBoosts) {
  const detail = details.get(player.id);
  if (!detail) return -Infinity;
  const oprkRank = getOprkMatchup(detail, getOpponentRank)?.rank ?? null;
  return computeRecommendationScore({
    projected: detail.projected ?? 0,
    oprkRank,
    hasOpportunityBoost: opportunityBoosts.has(player.id)
  });
}

// -Infinity as the "missing" sentinel means missing values always sort to
// the bottom of a descending sort — flip the whole comparator for ascending
// instead of flipping the sentinel, so that stays true either way.
//
// `recRankById` is passed in rather than recomputed here because it has to
// be stable across every sort mode — it's each player's position in the
// recommendation order (1 = best), computed once from the full filtered
// list before any display sort is applied. Sorting by "rank" ascending
// (its default first-click direction) is exactly the recommendation order,
// so clicking the Rank column doubles as a "back to the recommended list"
// reset.
function getSortValue(player, details, getOpponentRank, opportunityBoosts, recRankById, sortBy) {
  const detail = details.get(player.id);
  if (!detail) return -Infinity;

  if (sortBy === 'rank') {
    const rank = recRankById.get(player.id);
    return rank === undefined ? -Infinity : -rank;
  }
  if (sortBy === 'oprk') return getOprkMatchup(detail, getOpponentRank)?.rank ?? -Infinity;
  if (sortBy === 'owned') return player.percentOwned ?? -Infinity;
  if (sortBy === 'rec') return getRecommendationScore(player, details, getOpponentRank, opportunityBoosts);
  if (sortBy === 'last') return detail.actual ?? -Infinity;
  if (sortBy === 'avg') return detail.seasonAverage ?? -Infinity;
  if (sortBy === 'fpts') return detail.seasonTotal ?? -Infinity;
  return detail.projected ?? -Infinity;
}

function buildQueryString(params) {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return query ? `?${query}` : '';
}

async function renderWaiversPage({ position, sort, dir, limit, week } = {}) {
  const client = createClient();
  const league = await client.getLeagueInfo({ seasonId: config.seasonId });
  const scoringPeriodId = week ?? league.currentScoringPeriodId;
  const sortBy = sort ?? 'proj';
  const sortDir = dir === 'asc' ? 'asc' : 'desc';
  const rowLimit = limit ?? 25;

  const [freeAgents, details, getOpponentRank, leagueWidePlayers] = await Promise.all([
    client.getFreeAgents({ seasonId: config.seasonId, scoringPeriodId }),
    getFreeAgentDetails({ seasonId: config.seasonId, scoringPeriodId }),
    loadMatchupLookup({ seasonId: config.seasonId, scoringPeriodId }),
    getLeagueWidePlayers({ seasonId: config.seasonId, scoringPeriodId })
  ]);
  const opportunityBoosts = findOpportunityBoosts(leagueWidePlayers);

  let candidates = freeAgents.filter((player) => !player.isInjured || player.injuryStatus !== 'OUT');
  if (position) {
    candidates = candidates.filter((player) => details.get(player.id)?.position === position);
  }

  // Recommendation order, fixed regardless of the column currently sorted
  // on — see the comment on getSortValue's 'rank' branch.
  const recRanked = [...candidates].sort(
    (a, b) =>
      getRecommendationScore(b, details, getOpponentRank, opportunityBoosts) -
      getRecommendationScore(a, details, getOpponentRank, opportunityBoosts)
  );
  const recRankById = new Map(recRanked.map((player, index) => [player.id, index + 1]));

  const directionMultiplier = sortDir === 'asc' ? -1 : 1;
  const ranked = candidates
    .sort(
      (a, b) =>
        directionMultiplier *
        (getSortValue(b, details, getOpponentRank, opportunityBoosts, recRankById, sortBy) -
          getSortValue(a, details, getOpponentRank, opportunityBoosts, recRankById, sortBy))
    )
    .slice(0, rowLimit);

  const rows = ranked
    .map((player) => {
      const detail = details.get(player.id);
      const boost = opportunityBoosts.get(player.id);
      const recScore = getRecommendationScore(player, details, getOpponentRank, opportunityBoosts);
      const isLocked = detail?.isLocked ?? false;

      return `<tr${isLocked ? ' style="opacity:0.6"' : ''}>
        <td>${recRankById.get(player.id) ?? '-'}</td>
        <td>${escapeHtml(player.fullName)}</td>
        <td>${escapeHtml(detail?.position ?? '-')}</td>
        <td>${escapeHtml(player.proTeamAbbreviation)}</td>
        <td>${renderOprkCell(detail, getOpponentRank)}</td>
        <td>${boost ? `<span class="pill boost">↑ ${escapeHtml(boost.name)} ${escapeHtml(boost.injuryStatus)}</span>` : '-'}</td>
        <td>${isLocked ? '<span class="pill">locked</span>' : '-'}</td>
        <td>${player.percentOwned?.toFixed(1) ?? '-'}</td>
        <td>${player.isInjured ? `<span class="pill">${escapeHtml(player.injuryStatus)}</span>` : '-'}</td>
        <td>${(detail?.projected ?? 0).toFixed(1)}</td>
        <td><strong>${recScore.toFixed(1)}</strong></td>
        <td>${isLocked ? (detail?.actual ?? 0).toFixed(1) : '-'}</td>
        <td>${(detail?.seasonAverage ?? 0).toFixed(1)}</td>
        <td>${(detail?.seasonTotal ?? 0).toFixed(1)}</td>
      </tr>`;
    })
    .join('');

  const positionOptions = ['', ...POSITIONS]
    .map((p) => `<option value="${p}"${p === (position ?? '') ? ' selected' : ''}>${p || 'All'}</option>`)
    .join('');
  const weekOptions = Array.from({ length: 18 }, (_, i) => i + 1)
    .map((w) => `<option value="${w}"${w === scoringPeriodId ? ' selected' : ''}>${w}</option>`)
    .join('');

  // Non-sortable header cells (Name, Pos, Team, Opportunity, Locked, Injury)
  // are plain text; sortable ones link back to this same page with that
  // column's key, toggling direction if it's already the active sort.
  const nonSortableHeaders = { name: 'Name', pos: 'Pos', team: 'Team', opportunity: 'Opportunity', locked: 'Locked', injury: 'Injury' };
  const sortColumnByKey = new Map(SORT_COLUMNS.map((c) => [c.key, c]));

  function sortableHeader(key) {
    const column = sortColumnByKey.get(key);
    const isActive = sortBy === key;
    const nextDir = isActive && sortDir === 'desc' ? 'asc' : 'desc';
    const href = buildQueryString({ position, week: scoringPeriodId, limit: rowLimit, sort: key, dir: nextDir });
    const arrow = isActive ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';
    return `<a href="/waivers${href}" style="color:inherit;text-decoration:none;">${column.label}${arrow}</a>`;
  }

  const body = `
    <div class="card">
      <h2>Waiver Wire Recommendations — Week ${scoringPeriodId}</h2>
      <p class="muted">
        OPRK: defense rank against the position, 1 = toughest matchup, 32 = easiest.
        Opportunity: a draft-relevant teammate ahead of them is OUT/DOUBTFUL/IR.
        Locked: their game for this week already started/finished — adding them won't help this week
        (proj pts is stale, actual pts reflects their real result).
        Rec score: proj pts adjusted by OPRK (±15%) and opportunity (+20%).
        Rank: this player's position in the recommendation order, no matter what you've sorted by —
        click it to get back to the recommended list.
        Click any column header to sort by it; click again to flip direction.
      </p>
      <form class="filters" method="get" action="/waivers">
        <label>Position
          <select name="position">${positionOptions}</select>
        </label>
        <label>Week
          <select name="week">${weekOptions}</select>
        </label>
        <label>Limit
          <input type="number" name="limit" value="${rowLimit}" min="1" max="200" />
        </label>
        <input type="hidden" name="sort" value="${escapeHtml(sortBy)}" />
        <input type="hidden" name="dir" value="${escapeHtml(sortDir)}" />
        <button type="submit">Update</button>
      </form>
      <table>
        <thead>
          <tr>
            <th>${sortableHeader('rank')}</th>
            <th>${nonSortableHeaders.name}</th>
            <th>${nonSortableHeaders.pos}</th>
            <th>${nonSortableHeaders.team}</th>
            <th>${sortableHeader('oprk')}</th>
            <th>${nonSortableHeaders.opportunity}</th>
            <th>${nonSortableHeaders.locked}</th>
            <th>${sortableHeader('owned')}</th>
            <th>${nonSortableHeaders.injury}</th>
            <th>${sortableHeader('proj')}</th>
            <th>${sortableHeader('rec')}</th>
            <th>${sortableHeader('last')}</th>
            <th>${sortableHeader('avg')}</th>
            <th>${sortableHeader('fpts')}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  return renderLayout({ title: 'Waiver Wire', activePath: '/waivers', body });
}

module.exports = { renderWaiversPage };
