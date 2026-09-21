// Same "top/bottom 10" thresholds used for OPRK color-coding elsewhere
// (src/web/layout.js's oprkClass) — 1-10 is a tough matchup, 23-32 is easy.
const TOUGH_RANK_THRESHOLD = 10;
const EASY_RANK_THRESHOLD = 23;

const LOOKAHEAD_WEEKS = 3;
// A single bad matchup isn't a "stretch" — require at least two tough (or
// easy) weeks in the window before it's worth flagging.
const MIN_STRETCH_WEEKS = 2;

const TOP_N_BY_POSITION = { QB: 10, RB: 20, WR: 20, TE: 5 };

function buildLookaheadWeeks(startWeek) {
  return Array.from({ length: LOOKAHEAD_WEEKS }, (_, i) => startWeek + i);
}

// Top-N currently-productive players (by season-per-game average) per
// position, owned by teams other than mine — free agents are excluded
// since this is about trade targets, not waiver pickups (already covered
// by the waiver page), and my own roster is excluded since you can't
// "buy low" on your own player.
function getTopPlayersByPosition({ teams, myTeamId }) {
  const byPosition = new Map();

  Object.entries(TOP_N_BY_POSITION).forEach(([position, topN]) => {
    const players = teams
      .flatMap(({ teamId, teamName, roster }) =>
        teamId === myTeamId ? [] : roster.filter((p) => p.position === position).map((p) => ({ ...p, teamId, teamName }))
      )
      .sort((a, b) => b.seasonAverage - a.seasonAverage)
      .slice(0, topN);

    byPosition.set(position, players);
  });

  return byPosition;
}

// Primary ask: top-tier players elsewhere in the league who are about to
// run into a real stretch of tough matchups. Their current owner may not
// have priced that in yet — this is who to watch for a buy-low window to
// open up over the next few weeks, before it shows up in their actual
// production (and before everyone else notices too).
function findToughScheduleWatchList({ teams, myTeamId, getOpponentRanksForWeeks, startWeek }) {
  const weeks = buildLookaheadWeeks(startWeek);
  const topByPosition = getTopPlayersByPosition({ teams, myTeamId });
  const results = [];

  topByPosition.forEach((players) => {
    players.forEach((player) => {
      const matchups = getOpponentRanksForWeeks({
        proTeamId: player.proTeamId,
        positionId: player.positionId,
        weeks
      });
      const toughCount = matchups.filter((m) => m.rank !== null && m.rank <= TOUGH_RANK_THRESHOLD).length;
      if (toughCount >= MIN_STRETCH_WEEKS) {
        results.push({ player, matchups, toughCount });
      }
    });
  });

  results.sort((a, b) => b.toughCount - a.toughCount);
  return results;
}

// Bonus angle: cross-references the existing (reactive) buy-low list —
// players already underperforming their draft slot — against their
// upcoming schedule. A buy-low candidate whose schedule is about to get
// easier is a much stronger signal than either fact alone: it's not just
// "they've been bad," it's "they've been bad AND the matchups that were
// probably part of why are about to improve."
function findBuyLowWithFavorableSchedule({ buyLowCandidates, getOpponentRanksForWeeks, startWeek }) {
  const weeks = buildLookaheadWeeks(startWeek);

  return buyLowCandidates
    .map((candidate) => {
      const matchups = getOpponentRanksForWeeks({
        proTeamId: candidate.proTeamId,
        positionId: candidate.positionId,
        weeks
      });
      const easyCount = matchups.filter((m) => m.rank !== null && m.rank >= EASY_RANK_THRESHOLD).length;
      return { ...candidate, matchups, easyCount };
    })
    .filter((c) => c.easyCount >= MIN_STRETCH_WEEKS)
    .sort((a, b) => b.easyCount - a.easyCount);
}

module.exports = {
  findToughScheduleWatchList,
  findBuyLowWithFavorableSchedule,
  buildLookaheadWeeks,
  TOP_N_BY_POSITION,
  TOUGH_RANK_THRESHOLD,
  EASY_RANK_THRESHOLD
};
