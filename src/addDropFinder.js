// Minimum projected-point margin before bothering to suggest a swap — a
// 0.3 pt "upgrade" isn't worth the roster move.
const MIN_UPGRADE = 1.0;

// Anything within this much of the bar (but under it) is worth surfacing
// separately as a "near miss" — a real but modest edge you can judge for
// yourself, rather than silently discarding it alongside genuinely
// pointless options.
const NEAR_MISS_MARGIN = 0.5;

// Up to this many near misses per position — otherwise two candidates
// tied at the same upgrade (e.g. two WRs both +0.6 over your weakest bench
// WR) would silently collapse to just one, hiding a real option.
const NEAR_MISSES_PER_POSITION = 3;

// Matches the best available waiver pickups against the weakest bench
// player at the same position, so "who should I add" also answers "who do
// I drop for them" — the two questions are pointless to answer separately.
// `candidates` should already be filtered to real options for this week
// (not OUT, not locked) and sorted by whatever priority the caller wants
// (e.g. recommendation score) — the best candidate gets first claim on a
// drop slot, and each bench player is only offered up once.
//
// Two different questions get two different metrics, deliberately:
//
// - WHICH player is droppable is judged by season-per-game average. A drop
//   is a permanent decision, and one week's matchup swing shouldn't decide
//   it — a player who's been your best bench option all year but has a
//   rough matchup this week is not who you should be cutting.
//
// - WHETHER the swap is actually worth making is judged by THIS WEEK's
//   projection, on both sides. Early in a season this is the more reliable
//   number by far: ESPN's weekly projection is a modeled forecast that
//   accounts for matchup, role, and recent usage, while a 2-3 game season
//   average is closer to noise — one huge game can put a bench piece's
//   average above a star's. Using season average for this comparison
//   actively backfires (it happily "found" a downgrade from a 21-point
//   projected QB to an 18-point one, because the 21-point QB's average was
//   dragged down by early-season bench snaps). A genuinely great season-long
//   performer having one so-so single-week projection won't clear this bar
//   — that's a real, known tradeoff, not a bug — but it'll usually still
//   show up in the "near misses" list below for a judgment call, and the
//   Trade Recommendations page's Buy Low / position-strength views are the
//   better tool for season-long value plays anyway.
//
// If a position has NO bench player at all — the normal case for D/ST and
// K, and sometimes TE, which most rosters only carry one of — this falls
// back to comparing against the current STARTER instead. That's the
// classic "streaming" move (swap this week's defense/kicker for a better
// matchup) and would otherwise be invisible: a genuinely great pickup at a
// single-slot position could never surface if the only comparison pool was
// an empty bench. This fallback only kicks in when there's truly no bench
// option at that position — if bench depth exists, a starter is never
// touched here, since starter/bench decisions are the lineup optimizer's
// job, not this one's.
//
// Returns both the actual suggestions and, separately, "near misses" — real
// but sub-threshold upgrades, up to NEAR_MISSES_PER_POSITION per position,
// so a close call (or several tied ones) isn't invisible just because it
// didn't clear the bar.
function findAddDropSuggestions({ starters, benchPlayers, candidates, limit = 5 }) {
  const usedDropIds = new Set();
  const suggestions = [];
  const nearMissesByPosition = new Map();

  candidates.forEach((candidate) => {
    const benchPool = benchPlayers.filter((b) => b.position === candidate.position && !usedDropIds.has(b.id));
    const pool =
      benchPool.length > 0
        ? benchPool
        : starters.filter((s) => s.position === candidate.position && !usedDropIds.has(s.id));

    const weakest = [...pool].sort((a, b) => a.seasonAverage - b.seasonAverage)[0];
    if (!weakest) return;

    const isStreamStart = benchPool.length === 0;
    const upgrade = candidate.projected - weakest.projected;

    if (upgrade >= MIN_UPGRADE) {
      usedDropIds.add(weakest.id);
      suggestions.push({ add: candidate, drop: weakest, upgrade, isStreamStart });
      return;
    }

    if (upgrade >= MIN_UPGRADE - NEAR_MISS_MARGIN) {
      if (!nearMissesByPosition.has(candidate.position)) {
        nearMissesByPosition.set(candidate.position, []);
      }
      nearMissesByPosition.get(candidate.position).push({ add: candidate, drop: weakest, upgrade, isStreamStart });
    }
  });

  suggestions.sort((a, b) => b.upgrade - a.upgrade);

  const nearMisses = [...nearMissesByPosition.values()]
    .flatMap((group) => group.sort((a, b) => b.upgrade - a.upgrade).slice(0, NEAR_MISSES_PER_POSITION))
    .sort((a, b) => b.upgrade - a.upgrade);

  return { suggestions: suggestions.slice(0, limit), nearMisses };
}

module.exports = { findAddDropSuggestions, MIN_UPGRADE, NEAR_MISS_MARGIN };
