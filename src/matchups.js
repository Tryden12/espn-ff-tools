const axios = require('axios');
const config = require('./config');

// Each proTeam's opponent per scoring period, season-wide (not league-scoped).
async function getProTeamSchedule(seasonId) {
  const response = await axios.get(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${seasonId}`, {
    params: { view: 'proTeamSchedules' },
    headers: { Cookie: `espn_s2=${config.espnS2}; SWID=${config.swid}` }
  });

  const schedule = new Map();

  (response.data?.settings?.proTeams ?? []).forEach((team) => {
    const byScoringPeriod = new Map();
    Object.entries(team.proGamesByScoringPeriod ?? {}).forEach(([scoringPeriodId, games]) => {
      const game = games[0];
      if (!game) return;
      const opponentId = game.homeProTeamId === team.id ? game.awayProTeamId : game.homeProTeamId;
      byScoringPeriod.set(Number(scoringPeriodId), opponentId);
    });
    schedule.set(team.id, byScoringPeriod);
  });

  return schedule;
}

// ESPN's OPRK: for a given position, how many fantasy points each proTeam's
// defense has allowed this season, and its rank among the 32 teams. This is
// the same data ESPN's own UI shows as "OPRK".
async function getPositionalRatings({ seasonId, scoringPeriodId }) {
  const response = await axios.get(
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${seasonId}/segments/0/leagues/${config.leagueId}`,
    {
      params: { scoringPeriodId, view: 'mPositionalRatings' },
      headers: { Cookie: `espn_s2=${config.espnS2}; SWID=${config.swid}` }
    }
  );

  const ratings = response.data?.positionAgainstOpponent?.positionalRatings ?? {};
  const byPosition = new Map();

  Object.entries(ratings).forEach(([positionId, data]) => {
    const byOpponent = new Map();
    Object.entries(data.ratingsByOpponent ?? {}).forEach(([opponentId, value]) => {
      byOpponent.set(Number(opponentId), value);
    });
    byPosition.set(Number(positionId), byOpponent);
  });

  return byPosition;
}

// Loads both pieces and returns a lookup function: given a player's
// proTeamId and position, what's their opponent this week and how tough is
// that matchup? `rank` is ESPN's OPRK — 1 = toughest matchup for the
// position (defense allows the fewest points), 32 = easiest. Returns null
// for a bye week or missing data.
async function loadMatchupLookup({ seasonId, scoringPeriodId }) {
  const [schedule, positionalRatings] = await Promise.all([
    getProTeamSchedule(seasonId),
    getPositionalRatings({ seasonId, scoringPeriodId })
  ]);

  return function getOpponentRank({ proTeamId, positionId }) {
    const opponentId = schedule.get(proTeamId)?.get(scoringPeriodId);
    if (opponentId === undefined) return null;

    const rating = positionalRatings.get(positionId)?.get(opponentId);
    if (!rating) return { opponentProTeamId: opponentId, rank: null, averageAllowed: null };

    return { opponentProTeamId: opponentId, rank: rating.rank, averageAllowed: rating.average };
  };
}

// Same as loadMatchupLookup, but across several weeks at once — the
// schedule is season-wide so it's fetched once, while positional ratings
// (which change week to week as more games are played) are fetched per
// week in parallel. Used for "what does this player's next few weeks look
// like" schedule-strength analysis.
async function loadMultiWeekMatchupLookup({ seasonId, scoringPeriodIds }) {
  const [schedule, ratingsEntries] = await Promise.all([
    getProTeamSchedule(seasonId),
    Promise.all(
      scoringPeriodIds.map(async (scoringPeriodId) => [
        scoringPeriodId,
        await getPositionalRatings({ seasonId, scoringPeriodId })
      ])
    )
  ]);
  const ratingsByWeek = new Map(ratingsEntries);

  return function getOpponentRanksForWeeks({ proTeamId, positionId, weeks }) {
    return weeks.map((week) => {
      const opponentId = schedule.get(proTeamId)?.get(week);
      if (opponentId === undefined) return { week, rank: null, opponentProTeamId: null };

      const rating = ratingsByWeek.get(week)?.get(positionId)?.get(opponentId);
      return { week, rank: rating?.rank ?? null, opponentProTeamId: opponentId };
    });
  };
}

module.exports = { getProTeamSchedule, getPositionalRatings, loadMatchupLookup, loadMultiWeekMatchupLookup };
