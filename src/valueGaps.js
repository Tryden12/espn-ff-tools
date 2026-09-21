const { TRADE_POSITIONS } = require('./positionStrength');

// Compares each player's preseason expectation (average draft rank, stable
// and not subject to small-sample noise) against how they're actually
// performing this season (rank by season-per-game average, within the same
// position). A big positive gap means they're outperforming their preseason
// billing — a sell-high candidate, since their trade value is probably
// higher right now than their long-run talent level supports. A big
// negative gap means the opposite — a buy-low candidate, since their
// current price is depressed relative to what they were drafted to be.
function computeValueGaps({ teams }) {
  const gaps = [];

  TRADE_POSITIONS.forEach((position) => {
    const players = teams
      .flatMap(({ teamId, teamName, roster }) =>
        roster.filter((p) => p.position === position && p.draftRank !== Infinity).map((p) => ({ ...p, teamId, teamName }))
      );

    if (players.length < 4) return; // too small a sample for ranks to mean much

    const byPreseason = [...players].sort((a, b) => a.draftRank - b.draftRank);
    const byCurrent = [...players].sort((a, b) => b.seasonAverage - a.seasonAverage);
    const preseasonRankById = new Map(byPreseason.map((p, i) => [p.id, i + 1]));
    const currentRankById = new Map(byCurrent.map((p, i) => [p.id, i + 1]));

    players.forEach((p) => {
      const preseasonRank = preseasonRankById.get(p.id);
      const currentRank = currentRankById.get(p.id);
      gaps.push({ ...p, position, preseasonRank, currentRank, gap: preseasonRank - currentRank });
    });
  });

  return gaps;
}

module.exports = { computeValueGaps };
