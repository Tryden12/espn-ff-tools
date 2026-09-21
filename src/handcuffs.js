const { positionIdToName } = require('./positions');

// Scoped to RB only, matching the classic fantasy "handcuff" meaning: the
// direct backup who'd inherit the bulk of the starter's touches if they're
// hurt. WR/TE "QB2" situations don't carry the same all-or-nothing
// insurance dynamic — a team's WR2 already gets real usage regardless of
// WR1's health, so labeling it a "handcuff" would overstate the case.
const HANDCUFF_POSITIONS = new Set(['RB']);

// Same relevance cutoff and rationale as src/depthChart.js: only a
// draft-relevant player being "ahead" of someone means anything — otherwise
// two late-round/undrafted bench players ahead of and behind each other on
// a real NFL depth chart is just noise.
const RELEVANT_RANK_THRESHOLD = 200;

// The starter also has to be *meaningfully* better ranked than the backup —
// otherwise two backs a few ranks apart are really just a committee, not a
// clear starter/insurance relationship (e.g. two RBs drafted 142nd and
// 149th are effectively co-starters, not a handcuff situation).
const MIN_RANK_GAP = 40;

// Finds, for every rostered player in the league, whether the teammate
// immediately ahead of them on their real NFL team's depth chart (again
// proxied by preseason draft rank, since ESPN doesn't expose real depth
// charts) is owned by a DIFFERENT fantasy team. If so, that's a handcuff:
// the player is largely valuable as insurance for whoever owns the starter,
// which makes them a natural, low-cost trade chip to offer that specific
// manager — more valuable to them than to a team that doesn't own the
// starter they'd be insuring.
//
// `teams` is [{ teamId, teamName, roster: [...] }]. Only rostered players
// are considered — if the better-ranked teammate is a free agent, that's a
// waiver-wire opportunity (already surfaced by src/depthChart.js), not a
// trade one.
function findHandcuffOpportunities({ teams, myTeamId }) {
  const allRostered = teams.flatMap(({ teamId, teamName, roster }) =>
    roster.map((player) => ({ ...player, teamId, teamName }))
  );

  const groups = new Map(); // "proTeamId:positionId" -> players[]
  allRostered.forEach((p) => {
    if (!HANDCUFF_POSITIONS.has(positionIdToName[p.positionId])) return;
    const key = `${p.proTeamId}:${p.positionId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  });

  const opportunities = [];

  groups.forEach((group) => {
    const sorted = [...group].sort((a, b) => a.draftRank - b.draftRank);
    for (let i = 1; i < sorted.length; i++) {
      const starter = sorted[i - 1];
      const backup = sorted[i];

      if (
        backup.teamId === myTeamId &&
        starter.teamId !== myTeamId &&
        starter.draftRank <= RELEVANT_RANK_THRESHOLD &&
        backup.draftRank - starter.draftRank >= MIN_RANK_GAP
      ) {
        opportunities.push({
          myPlayer: backup,
          starter,
          starterOwnerTeamId: starter.teamId,
          starterOwnerTeamName: starter.teamName
        });
      }
    }
  });

  return opportunities;
}

module.exports = { findHandcuffOpportunities };
