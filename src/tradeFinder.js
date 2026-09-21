const { categorizeStrength, TRADE_POSITIONS } = require('./positionStrength');

function buildSuggestion({ myTeamId, teamNames, give, get, withTeamId, myWeakestStarter, tier }) {
  return {
    tier,
    withTeamId,
    withTeamName: teamNames.get(withTeamId),
    give,
    get,
    upgrade: myWeakestStarter ? get.player.seasonAverage - myWeakestStarter.seasonAverage : get.player.seasonAverage,
    valueDiff: Math.abs(give.player.seasonAverage - get.player.seasonAverage)
  };
}

function dedupeAndSort(suggestions) {
  const seen = new Set();
  const deduped = suggestions.filter((s) => {
    const key = `${s.withTeamId}:${s.give.player.id}:${s.get.player.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Best first: real upgrades over what I'm currently starting, and among
  // those, the fairest (closest in value) so it's realistic the other side
  // would actually consider it.
  deduped.sort((a, b) => b.upgrade - a.upgrade || a.valueDiff - b.valueDiff);
  return deduped;
}

// Finds trade partners with complementary needs: teams that are weak where
// I'm strong (so they'd want what I can spare) and strong where I'm weak
// (so they have a spare piece worth having). Both sides only ever offer a
// "surplus" player — someone beyond their own starting lineup at that
// position — so the suggestion is something a real manager could plausibly
// afford to give up without hurting their own starting lineup.
//
// With a small league (as few as 8-10 teams), requiring BOTH conditions to
// hold is often too strict to find anything — so this returns two tiers:
// 'complementary' (both sides' needs align — a trade they'd likely say yes
// to) and 'upgrade-only' (a team strong enough at my weak position to have
// a spare, regardless of whether they happen to want what I'm strong in —
// still worth offering, just a less certain fit). Only real upgrades over
// my current weakest starter at that position are included either way.
function findComplementaryTrades({ myTeamId, teamStrengths, teamNames }) {
  const numTeams = teamStrengths.size;
  const my = teamStrengths.get(myTeamId);
  if (!my) return [];

  const myStrongPositions = TRADE_POSITIONS.filter(
    (pos) => categorizeStrength(my.positions[pos].rank, numTeams) === 'STRONG'
  );
  const myWeakPositions = TRADE_POSITIONS.filter(
    (pos) => categorizeStrength(my.positions[pos].rank, numTeams) === 'WEAK'
  );

  const complementary = [];
  const upgradeOnly = [];

  myWeakPositions.forEach((weakPos) => {
    const myStarters = my.positions[weakPos].starters;
    const myWeakestStarter = myStarters[myStarters.length - 1] ?? null;

    teamStrengths.forEach((other, otherTeamId) => {
      if (otherTeamId === myTeamId) return;

      const theyHaveDepthWhereImWeak = categorizeStrength(other.positions[weakPos].rank, numTeams) === 'STRONG';
      if (!theyHaveDepthWhereImWeak) return;

      const get = other.positions[weakPos].surplus[0];
      if (!get) return;

      const isRealUpgrade = myWeakestStarter ? get.seasonAverage > myWeakestStarter.seasonAverage : true;
      if (!isRealUpgrade) return;

      // Prefer offering from a strong position of mine that they happen to
      // need; fall back to any strong-or-average position's best surplus.
      const theyNeedPosition = myStrongPositions.find(
        (strongPos) => categorizeStrength(other.positions[strongPos].rank, numTeams) === 'WEAK'
      );

      if (theyNeedPosition && my.positions[theyNeedPosition].surplus[0]) {
        complementary.push(
          buildSuggestion({
            myTeamId,
            teamNames,
            give: { player: my.positions[theyNeedPosition].surplus[0], position: theyNeedPosition },
            get: { player: get, position: weakPos },
            withTeamId: otherTeamId,
            myWeakestStarter,
            tier: 'complementary'
          })
        );
      } else {
        const bestGive = myStrongPositions
          .map((pos) => ({ pos, player: my.positions[pos].surplus[0] }))
          .find((c) => c.player);
        if (bestGive) {
          upgradeOnly.push(
            buildSuggestion({
              myTeamId,
              teamNames,
              give: { player: bestGive.player, position: bestGive.pos },
              get: { player: get, position: weakPos },
              withTeamId: otherTeamId,
              myWeakestStarter,
              tier: 'upgrade-only'
            })
          );
        }
      }
    });
  });

  return { complementary: dedupeAndSort(complementary), upgradeOnly: dedupeAndSort(upgradeOnly) };
}

module.exports = { findComplementaryTrades };
