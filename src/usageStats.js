// ESPN's raw per-stat IDs (distinct from the scored/applied totals used
// everywhere else in this app). Targets and carries are opportunity/volume
// stats — how much a player is actually being used — which is often a more
// stable, leading signal than points scored, especially over a small
// sample: a player getting a lot of work but scoring inefficiently is a
// classic buy-low/waiver profile, while a player scoring well on very few
// touches is a bigger regression risk than their point total alone shows.
const TARGETS_STAT_ID = '58';
const CARRIES_STAT_ID = '23';

// `seasonEntry` is the same season-to-date stats entry already located
// elsewhere in this app (statSourceId 0, statSplitTypeId 0, scoringPeriodId
// 0, matched to the current seasonId) — this just also reads its raw
// per-stat breakdown, which callers otherwise only use for the scored
// `appliedTotal`/`appliedAverage`.
function extractSeasonUsage(seasonEntry) {
  const raw = seasonEntry?.stats ?? {};
  return {
    targets: raw[TARGETS_STAT_ID] ?? 0,
    carries: raw[CARRIES_STAT_ID] ?? 0
  };
}

// ESPN doesn't expose games-played directly, but appliedAverage is always
// appliedTotal / gamesPlayed, so it can be backed out from numbers this app
// already fetches rather than needing a new field or API call.
function computeGamesPlayed({ seasonTotal, seasonAverage }) {
  if (!seasonAverage) return 0;
  return Math.max(0, Math.round(seasonTotal / seasonAverage));
}

// Which raw usage stats are shown, per position — and which aren't. QB,
// D/ST, and K don't get a usage read at all (targets/carries isn't a
// meaningful concept for them here). RBs show BOTH carries and targets,
// not just carries: in a PPR league a running back's receiving work is
// real fantasy value, and carries-only would hide it.
function usageEntries(position, usage) {
  if (position === 'WR' || position === 'TE') return [{ label: 'tgt', value: usage.targets }];
  if (position === 'RB') return [{ label: 'car', value: usage.carries }, { label: 'tgt', value: usage.targets }];
  return [];
}

function formatUsageTotal(position, usage) {
  const entries = usageEntries(position, usage);
  if (entries.length === 0) return '-';
  return entries.map((e) => `${e.value} ${e.label}`).join(', ');
}

function formatUsageAverage(position, usage, gamesPlayed) {
  const entries = usageEntries(position, usage);
  if (entries.length === 0) return '-';
  return entries.map((e) => `${(gamesPlayed > 0 ? e.value / gamesPlayed : 0).toFixed(1)} ${e.label}`).join(', ');
}

// A single sortable number: total touches (carries + targets for RB, just
// targets for WR/TE), optionally per-game.
function usageSortValue(position, usage, { perGame = false, gamesPlayed = 0 } = {}) {
  const total = usageEntries(position, usage).reduce((sum, e) => sum + e.value, 0);
  if (!perGame) return total;
  return gamesPlayed > 0 ? total / gamesPlayed : 0;
}

module.exports = {
  extractSeasonUsage,
  computeGamesPlayed,
  usageEntries,
  formatUsageTotal,
  formatUsageAverage,
  usageSortValue,
  TARGETS_STAT_ID,
  CARRIES_STAT_ID
};
