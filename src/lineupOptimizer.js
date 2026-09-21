const { slotIdToPosition } = require('./positions');

const nameToSlotId = Object.fromEntries(Object.entries(slotIdToPosition).map(([id, name]) => [name, Number(id)]));

const NON_STARTING_SLOTS = new Set(['Bench', 'IR']);

function buildStartingSlotInstances(lineupPositionCount) {
  const instances = [];
  Object.entries(lineupPositionCount).forEach(([name, count]) => {
    if (!count || NON_STARTING_SLOTS.has(name)) return;
    const slotId = nameToSlotId[name];
    if (slotId === undefined) return;
    for (let i = 0; i < count; i++) {
      instances.push(slotId);
    }
  });
  return instances;
}

// Finds the maximum-total-projected-points lineup. Locked players (their
// game already started) keep their current slot untouched; every unlocked
// starting slot is refilled from the pool of unlocked starters + unlocked
// bench players via bitmask DP over (slot index, used-player mask). This is
// an exact optimum, not a heuristic — feasible because roster sizes here are
// tiny (well under 20 players, under 10 starting slots), so the state space
// (slots * 2^players) is a few hundred thousand at most.
function optimizeLineup({ starters, bench, lineupPositionCount }) {
  const allSlotInstances = buildStartingSlotInstances(lineupPositionCount);

  const lockedStarters = starters.filter((p) => p.isLocked);
  const openSlotInstances = [...allSlotInstances];
  lockedStarters.forEach((p) => {
    const idx = openSlotInstances.indexOf(p.lineupSlotId);
    if (idx !== -1) openSlotInstances.splice(idx, 1);
  });

  const currentOpenStarters = starters.filter((p) => !p.isLocked);
  const candidatePlayers = [...currentOpenStarters, ...bench.filter((p) => !p.isLocked)];

  const n = candidatePlayers.length;
  const m = openSlotInstances.length;

  if (m === 0) {
    return { openSlotInstances: [], currentOpenStarters, optimalAssignments: [], baseline: 0, bestTotal: 0 };
  }

  const baseline = currentOpenStarters.reduce((sum, p) => sum + p.projected, 0);

  // dp maps a bitmask of used candidatePlayers -> best total points for the
  // slots placed so far. parent[slotIndex] records, for each resulting
  // mask, which player filled that slot and what the previous mask was.
  let dp = new Map([[0, 0]]);
  const parent = [];

  for (let slotIndex = 0; slotIndex < m; slotIndex++) {
    const slotId = openSlotInstances[slotIndex];
    const nextDp = new Map();
    const slotParent = new Map();

    for (const [mask, total] of dp.entries()) {
      for (let playerIndex = 0; playerIndex < n; playerIndex++) {
        if (mask & (1 << playerIndex)) continue;
        const player = candidatePlayers[playerIndex];
        if (!player.eligibleSlots.includes(slotId)) continue;

        const newMask = mask | (1 << playerIndex);
        const newTotal = total + player.projected;

        if (!nextDp.has(newMask) || nextDp.get(newMask) < newTotal) {
          nextDp.set(newMask, newTotal);
          slotParent.set(newMask, { prevMask: mask, playerIndex });
        }
      }
    }

    dp = nextDp;
    parent.push(slotParent);
  }

  if (dp.size === 0) {
    throw new Error('No valid lineup assignment found — check roster eligibility data.');
  }

  let bestMask = null;
  let bestTotal = -Infinity;
  for (const [mask, total] of dp.entries()) {
    if (total > bestTotal) {
      bestTotal = total;
      bestMask = mask;
    }
  }

  const assignedPlayers = new Array(m);
  let mask = bestMask;
  for (let slotIndex = m - 1; slotIndex >= 0; slotIndex--) {
    const { prevMask, playerIndex } = parent[slotIndex].get(mask);
    assignedPlayers[slotIndex] = candidatePlayers[playerIndex];
    mask = prevMask;
  }

  const optimalAssignments = openSlotInstances.map((slotId, i) => ({ slotId, player: assignedPlayers[i] }));

  return { openSlotInstances, currentOpenStarters, optimalAssignments, baseline, bestTotal };
}

// Diffs the current vs optimal occupants of each open slot *type* (not slot
// instance, since e.g. two RB slots are interchangeable) to produce clean
// "start this, sit that" pairs.
function buildChanges({ openSlotInstances, currentOpenStarters, optimalAssignments }) {
  const slotIds = [...new Set(openSlotInstances)];
  const changes = [];

  slotIds.forEach((slotId) => {
    const current = currentOpenStarters.filter((p) => p.lineupSlotId === slotId);
    const optimal = optimalAssignments.filter((a) => a.slotId === slotId).map((a) => a.player);

    const optimalIds = new Set(optimal.map((p) => p.id));
    const currentIds = new Set(current.map((p) => p.id));

    const sit = current.filter((p) => !optimalIds.has(p.id)).sort((a, b) => b.projected - a.projected);
    const start = optimal.filter((p) => !currentIds.has(p.id)).sort((a, b) => b.projected - a.projected);

    for (let i = 0; i < start.length; i++) {
      changes.push({ slotId, start: start[i], sit: sit[i], gain: start[i].projected - sit[i].projected });
    }
  });

  return changes;
}

module.exports = { optimizeLineup, buildChanges, buildStartingSlotInstances, nameToSlotId };
