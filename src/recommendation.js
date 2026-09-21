// Blends ESPN's projected points with matchup quality (OPRK) and
// injury-driven opportunity into one score, still expressed in
// point-equivalent units so it stays readable next to "proj pts". Projected
// points do the heavy lifting; the other signals only nudge the score,
// rather than being weighted as equal, independent factors — ESPN's own
// projections likely already bake in some of this context (especially
// matchup, and injury news that broke before projections were generated),
// so large, separate weights would risk double-counting it.
//
// OPRK rank 1-32, 16.5 is the neutral midpoint (no adjustment). Rank 32
// (easiest matchup) gets the full positive adjustment; rank 1 (toughest)
// gets the full negative one.
const OPRK_MAX_ADJUSTMENT = 0.15;
const OPRK_NEUTRAL_RANK = 16.5;
const OPRK_RANK_SPREAD = 16.5; // OPRK_NEUTRAL_RANK - 1, also 32 - OPRK_NEUTRAL_RANK

// A flat bump when a draft-relevant teammate ahead of this player on the
// depth chart (see src/depthChart.js) is OUT/DOUBTFUL/IR this week. Bigger
// than the OPRK adjustment because a role change (more snaps/touches/targets)
// is typically a larger swing in fantasy value than opponent strength, but
// still capped well short of doubling the player's value — this is
// opportunity, not a guarantee they convert it into production.
const OPPORTUNITY_ADJUSTMENT = 0.2;

function computeRecommendationScore({ projected, oprkRank, hasOpportunityBoost }) {
  let score = projected;

  if (oprkRank !== null && oprkRank !== undefined) {
    const oprkFactor = ((oprkRank - OPRK_NEUTRAL_RANK) / OPRK_RANK_SPREAD) * OPRK_MAX_ADJUSTMENT;
    score *= 1 + oprkFactor;
  }

  if (hasOpportunityBoost) {
    score *= 1 + OPPORTUNITY_ADJUSTMENT;
  }

  return score;
}

module.exports = { computeRecommendationScore };
