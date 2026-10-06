const { TRADE_POSITIONS } = require('./positionStrength');

const FLEX_KEY = 'RB/WR/TE';
const FLEX_POSITIONS = new Set(['RB', 'WR', 'TE']);

// Players below this FantasyCalc value are waiver-level filler — never worth
// building a trade around, and including them just multiplies near-duplicate
// suggestions ("same trade, plus a throw-in nobody wants").
const MIN_PLAYER_VALUE = 500;

// In a 2-for-1, the side getting the single best player is consolidating —
// that's worth a premium, because two mid players take two roster spots
// and can't both start in the one slot the star fills. Secondary pieces in a
// package count at this fraction of their raw value.
const SECONDARY_PIECE_WEIGHT = 0.85;

// How far apart (as a share of the bigger side) the two packages can be on
// FantasyCalc value and still count as a fair offer. Within NEAR_MISS it's
// close enough to show with the gap you'd need to cover.
const FAIR_TOLERANCE = 0.1;
const NEAR_MISS_TOLERANCE = 0.2;

// Bench depth matters — it covers byes and injuries — but much less than a
// starter. The best healthy bench RB/WR/TE counts at DEPTH_WEIGHTS[0] of
// their value, the next at DEPTH_WEIGHTS[1]. Without this, a team whose
// backups are all on IR looks no worse than one with a deep bench, and a
// 2-for-1 that gives them the depth they're desperate for scores as a pure
// loss because they gave up the best player.
const DEPTH_WEIGHTS = [0.5, 0.25];
const UNAVAILABLE_STATUSES = new Set(['INJURY_RESERVE', 'OUT']);

// A trade has to improve my team value (lineup + depth) by at least this
// much to be worth the hassle of proposing it.
const MIN_LINEUP_GAIN = 300;

// A partner whose team value gets worse than this is very unlikely to
// accept, even if the trade is even on paper — managers protect starters.
// When I'm shopping or targeting specific players, the same limit applies to
// my side instead of MIN_LINEUP_GAIN: moving or landing a chosen player at
// fair value is the point, so the trade only has to not hurt me much.
const MAX_LINEUP_LOSS = 300;

const MAX_PER_PARTNER = 2;
const MAX_PER_TARGET = 5;

function tradeValueOf(player) {
  return player.tradeValue ?? 0;
}

function attachTradeValues(teams, byEspnId) {
  return teams.map((team) => ({
    ...team,
    roster: team.roster.map((player) => {
      const fc = byEspnId.get(player.id);
      return { ...player, tradeValue: fc?.value ?? 0, tradeValueInfo: fc ?? null };
    })
  }));
}

// Best possible starting lineup by trade value: fill each dedicated slot with
// the most valuable players there, then FLEX from what's left. Greedy is
// exact here because FLEX is the only shared slot — putting your best RB in
// an RB slot rather than FLEX never loses value.
function computeLineupValue(roster, lineupPositionCount) {
  const used = new Set();
  let total = 0;
  const byValue = roster.filter((p) => tradeValueOf(p) > 0).sort((a, b) => tradeValueOf(b) - tradeValueOf(a));

  TRADE_POSITIONS.forEach((pos) => {
    byValue
      .filter((p) => p.position === pos)
      .slice(0, lineupPositionCount[pos] ?? 0)
      .forEach((p) => {
        used.add(p.id);
        total += tradeValueOf(p);
      });
  });

  byValue
    .filter((p) => FLEX_POSITIONS.has(p.position) && !used.has(p.id))
    .slice(0, lineupPositionCount[FLEX_KEY] ?? 0)
    .forEach((p) => {
      used.add(p.id);
      total += tradeValueOf(p);
    });

  return { total, starterIds: used };
}

// What a trade is judged on: best-lineup value plus partial credit for the
// healthiest, most valuable bench depth (see DEPTH_WEIGHTS). Players on IR or
// ruled OUT can't cover anyone, so they earn no depth credit.
function computeTeamValue(roster, lineupPositionCount) {
  const lineup = computeLineupValue(roster, lineupPositionCount);
  const depth = roster
    .filter(
      (p) =>
        FLEX_POSITIONS.has(p.position) &&
        !lineup.starterIds.has(p.id) &&
        !UNAVAILABLE_STATUSES.has(p.injuryStatus) &&
        tradeValueOf(p) > 0
    )
    .sort((a, b) => tradeValueOf(b) - tradeValueOf(a))
    .slice(0, DEPTH_WEIGHTS.length)
    .reduce((sum, p, index) => sum + tradeValueOf(p) * DEPTH_WEIGHTS[index], 0);

  return lineup.total + depth;
}

function packageValue(players) {
  const values = players.map(tradeValueOf).sort((a, b) => b - a);
  return values.reduce((sum, value, index) => sum + (index === 0 ? value : value * SECONDARY_PIECE_WEIGHT), 0);
}

function packagesOf(players) {
  const singles = players.map((p) => [p]);
  const pairs = [];
  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      pairs.push([players[i], players[j]]);
    }
  }
  return { singles, pairs };
}

function swapPlayers(roster, outgoing, incoming) {
  const outIds = new Set(outgoing.map((p) => p.id));
  return [...roster.filter((p) => !outIds.has(p.id)), ...incoming];
}

function tradeablePlayers(roster) {
  return roster.filter((p) => TRADE_POSITIONS.includes(p.position) && tradeValueOf(p) >= MIN_PLAYER_VALUE);
}

// Searches 1-for-1, 2-for-1 and 1-for-2 trades with every other team. A
// suggestion has to be (a) close to even on FantasyCalc market value, so the
// other manager has no reason to call it a lowball, (b) a real upgrade to my
// best starting lineup, and (c) not a meaningful downgrade to theirs. Value-
// even trades that still improve my lineup work by converting my surplus
// (value stuck on my bench) into starter quality where I'm thin — and when
// their lineup improves too, it's because my surplus fills one of their
// holes, which is what makes it a trade they'd actually say yes to.
//
// Pass `givePlayerIds` to shop specific players: only those players are
// offered (in any 1- or 2-player combination). Pass `targetPlayerIds` to go
// after specific players on other teams: only their owners are searched, and
// every offer has to bring back at least one target. Either way, (b) relaxes
// from "must improve my lineup" to "must not hurt it more than
// MAX_LINEUP_LOSS" — the point is to move or land a chosen player at fair
// value, not to find the single best upgrade.
function findValueTrades({
  myTeamId,
  teams,
  lineupPositionCount,
  teamNames,
  givePlayerIds = [],
  targetPlayerIds = []
}) {
  const me = teams.find((t) => t.teamId === myTeamId);
  if (!me) return { trades: [], nearMisses: [] };

  const isShopping = givePlayerIds.length > 0;
  const isTargeting = targetPlayerIds.length > 0;
  const shopIds = new Set(givePlayerIds);
  const targetIds = new Set(targetPlayerIds);
  const myGiveCandidates = isShopping
    ? me.roster.filter((p) => shopIds.has(p.id) && tradeValueOf(p) > 0)
    : tradeablePlayers(me.roster);
  const minMyGain = isShopping || isTargeting ? -MAX_LINEUP_LOSS : MIN_LINEUP_GAIN;
  const includesTarget = (pkg) => pkg.some((p) => targetIds.has(p.id));

  const myBaseline = computeTeamValue(me.roster, lineupPositionCount);
  const myPackages = packagesOf(myGiveCandidates);
  const candidates = [];

  teams.forEach((partner) => {
    if (partner.teamId === myTeamId) return;
    if (isTargeting && !partner.roster.some((p) => targetIds.has(p.id))) return;
    const partnerBaseline = computeTeamValue(partner.roster, lineupPositionCount);

    // A target below MIN_PLAYER_VALUE is still fair game — I asked for them.
    const theirCandidates = partner.roster.filter(
      (p) =>
        TRADE_POSITIONS.includes(p.position) &&
        (tradeValueOf(p) >= MIN_PLAYER_VALUE || (targetIds.has(p.id) && tradeValueOf(p) > 0))
    );
    const allTheirPackages = packagesOf(theirCandidates);
    const theirPackages = isTargeting
      ? {
          singles: allTheirPackages.singles.filter(includesTarget),
          pairs: allTheirPackages.pairs.filter(includesTarget)
        }
      : allTheirPackages;

    const shapes = [
      [myPackages.singles, theirPackages.singles],
      [myPackages.pairs, theirPackages.singles],
      [myPackages.singles, theirPackages.pairs]
    ];

    shapes.forEach(([gives, gets]) => {
      gives.forEach((give) => {
        const giveValue = packageValue(give);
        gets.forEach((get) => {
          const getValue = packageValue(get);
          const gap = getValue - giveValue;
          const gapShare = Math.abs(gap) / Math.max(giveValue, getValue);
          if (gapShare > NEAR_MISS_TOLERANCE) return;

          const myGain =
            computeTeamValue(swapPlayers(me.roster, give, get), lineupPositionCount) - myBaseline;
          if (myGain < minMyGain) return;

          const partnerGain =
            computeTeamValue(swapPlayers(partner.roster, get, give), lineupPositionCount) - partnerBaseline;
          // Normally a trade that guts their lineup is useless — they'll say
          // no. But when I've named a target, a fair-value price is still
          // worth knowing even if it costs them starters, so keep it as a
          // long shot instead of hiding it.
          const hurtsPartner = partnerGain < -MAX_LINEUP_LOSS;
          if (hurtsPartner && !isTargeting) return;

          candidates.push({
            withTeamId: partner.teamId,
            withTeamName: teamNames.get(partner.teamId) ?? `Team ${partner.teamId}`,
            give,
            get,
            giveValue,
            getValue,
            gap,
            gapShare,
            myGain,
            partnerGain,
            tier: hurtsPartner ? 'long-shot' : partnerGain > 0 ? 'mutual' : 'fair-value',
            isNearMiss: gapShare > FAIR_TOLERANCE
          });
        });
      });
    });
  });

  // Most likely to be accepted first (mutual, then fair value, then long
  // shots), then by how much my lineup improves, then by how close to even.
  const TIER_ORDER = { mutual: 0, 'fair-value': 1, 'long-shot': 2 };
  candidates.sort(
    (a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.myGain - a.myGain || a.gapShare - b.gapShare
  );

  // When targeting, what varies between offers is what I give (the return is
  // pinned to the target), so dedupe on that instead. The cap applies per
  // target rather than per partner, so two targets on the same team each get
  // their own set of offers.
  const targetsIn = (t) => ids(t.get.filter((p) => targetIds.has(p.id)));
  const diversifyOptions = isTargeting
    ? {
        keyOf: (t) => `${ids(t.give)}|${targetsIn(t)}`,
        groupOf: (t) => `${t.withTeamId}:${targetsIn(t)}`,
        maxPerGroup: MAX_PER_TARGET
      }
    : { keyOf: (t) => ids(t.get), groupOf: (t) => String(t.withTeamId), maxPerGroup: MAX_PER_PARTNER };

  // A near miss where I'm the one overpaying can be sent as-is (they'd only
  // be getting more), so it's more actionable than one where they'd want a
  // throw-in first — rank those first.
  const nearMisses = candidates
    .filter((c) => c.isNearMiss)
    .sort((a, b) => (a.gap <= 0 ? 0 : 1) - (b.gap <= 0 ? 0 : 1));

  return {
    trades: diversify(candidates.filter((c) => !c.isNearMiss), diversifyOptions),
    nearMisses: diversify(nearMisses, diversifyOptions)
  };
}

function ids(players) {
  return players
    .map((p) => p.id)
    .sort((a, b) => a - b)
    .join(',');
}

// The raw search returns many near-duplicates (the same target player with a
// different second piece attached). Keep the best version of each distinct
// offer per partner, and cap how many suggestions any one group gets.
function diversify(sorted, { keyOf, groupOf, maxPerGroup }) {
  const seen = new Set();
  const perGroup = new Map();

  return sorted.filter((trade) => {
    const key = `${trade.withTeamId}:${keyOf(trade)}`;
    if (seen.has(key)) return false;
    const group = groupOf(trade);
    const count = perGroup.get(group) ?? 0;
    if (count >= maxPerGroup) return false;

    seen.add(key);
    perGroup.set(group, count + 1);
    return true;
  });
}

module.exports = {
  attachTradeValues,
  computeLineupValue,
  findValueTrades,
  FAIR_TOLERANCE,
  NEAR_MISS_TOLERANCE,
  MAX_LINEUP_LOSS
};
