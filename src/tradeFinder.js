const { categorizeStrength, TRADE_POSITIONS } = require('./positionStrength');

// No real manager accepts a trade where the return is dramatically more
// valuable than what they're giving up — offering a bench WR3/4 for a
// top-5 QB just gets ignored or laughed at, not accepted. This caps how
// much more valuable (by season-per-game average) the player you'd receive
// can be than the player you're giving up. 1.5 is generous — real trades
// are usually closer to even — but still rules out the obviously
// unrealistic asks this was previously producing.
const MAX_VALUE_RATIO = 1.5;

// Trades between 1.5x and this ratio aren't realistic enough to recommend
// outright, but are still worth showing as a "near miss" — maybe worth a
// speculative offer, or a sign of exactly how much value you'd need to add
// (a throw-in) to make it work.
const NEAR_MISS_VALUE_RATIO = 2.5;

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

// How many times more valuable the received player is than the given one,
// by season-per-game average. A min value floor avoids treating a ~0 avg
// bench player as an infinite discount.
function valueRatio(givePlayer, getPlayer) {
  return getPlayer.seasonAverage / Math.max(givePlayer.seasonAverage, 1);
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
// hold is often too strict to find anything — so this returns two real
// tiers: 'complementary' (both sides' needs align — a trade they'd likely
// say yes to) and 'upgrade-only' (a team strong enough at my weak position
// to have a spare, regardless of whether they happen to want what I'm
// strong in — still worth offering, just a less certain fit). Only real
// upgrades over my current weakest starter at that position are included
// either way, AND only realistic offers (see MAX_VALUE_RATIO) — no
// suggestion here proposes trading a bench piece for a star.
//
// Separately returns 'nearMisses': the best available give for a get that
// was a real upgrade but didn't clear the realism bar — up to
// NEAR_MISS_VALUE_RATIO, so a close-but-not-quite trade (or a sense of what
// throw-in would be needed) isn't just silently discarded.
function findComplementaryTrades({ myTeamId, teamStrengths, teamNames }) {
  const numTeams = teamStrengths.size;
  const my = teamStrengths.get(myTeamId);
  if (!my) return { complementary: [], upgradeOnly: [], nearMisses: [] };

  const myStrongPositions = TRADE_POSITIONS.filter(
    (pos) => categorizeStrength(my.positions[pos].rank, numTeams) === 'STRONG'
  );
  // Target any position below the league median for a possible upgrade —
  // not just the strict bottom-third "WEAK" bucket. With a 10-team league,
  // WEAK only covers ranks 8-10, so a rank-7 position (clearly below
  // average, with real room to improve) would otherwise never be
  // considered. The categorical WEAK/AVERAGE/STRONG labels shown elsewhere
  // are about describing strength at a glance; this is about whether it's
  // worth *shopping* the position, which is a lower, more inclusive bar.
  const myWeakPositions = TRADE_POSITIONS.filter((pos) => my.positions[pos].rank > numTeams / 2);

  const complementary = [];
  const upgradeOnly = [];
  const nearMisses = [];

  function classify(give, get, weakPos, otherTeamId, myWeakestStarter, tierIfRealistic) {
    const ratio = valueRatio(give.player, get);
    const suggestion = buildSuggestion({
      myTeamId,
      teamNames,
      give,
      get: { player: get, position: weakPos },
      withTeamId: otherTeamId,
      myWeakestStarter,
      tier: ratio <= MAX_VALUE_RATIO ? tierIfRealistic : 'near-miss'
    });

    if (ratio <= MAX_VALUE_RATIO) {
      (tierIfRealistic === 'complementary' ? complementary : upgradeOnly).push(suggestion);
      return true;
    }
    if (ratio <= NEAR_MISS_VALUE_RATIO) {
      nearMisses.push(suggestion);
    }
    return false;
  }

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
      // need; fall back to whichever of my strong positions' surplus is
      // closest in value to a fair trade.
      const theyNeedPosition = myStrongPositions.find(
        (strongPos) => categorizeStrength(other.positions[strongPos].rank, numTeams) === 'WEAK'
      );
      const theyNeedGive = theyNeedPosition && my.positions[theyNeedPosition].surplus[0];

      if (
        theyNeedGive &&
        classify(
          { player: theyNeedGive, position: theyNeedPosition },
          get,
          weakPos,
          otherTeamId,
          myWeakestStarter,
          'complementary'
        )
      ) {
        return;
      }

      const bestGive = myStrongPositions
        .map((pos) => ({ pos, player: my.positions[pos].surplus[0] }))
        .filter((c) => c.player)
        .sort((a, b) => valueRatio(a.player, get) - valueRatio(b.player, get))[0];

      if (bestGive && (!theyNeedGive || bestGive.player.id !== theyNeedGive.id)) {
        classify(
          { player: bestGive.player, position: bestGive.pos },
          get,
          weakPos,
          otherTeamId,
          myWeakestStarter,
          'upgrade-only'
        );
      }
    });
  });

  return {
    complementary: dedupeAndSort(complementary),
    upgradeOnly: dedupeAndSort(upgradeOnly),
    nearMisses: dedupeAndSort(nearMisses)
  };
}

module.exports = { findComplementaryTrades, MAX_VALUE_RATIO, NEAR_MISS_VALUE_RATIO };
