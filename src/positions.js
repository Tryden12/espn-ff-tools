// `defaultPositionId` uses its own numbering, distinct from lineup slot ids
// (e.g. WR is slot 4 but defaultPositionId 3). espn-fantasy-football-api
// incorrectly reuses its slot-id-to-position map for both, which mislabels
// every skill position except RB and D/ST. Confirmed against raw API data.
const positionIdToName = {
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  5: 'K',
  16: 'D/ST'
};

const slotIdToPosition = {
  0: 'QB',
  1: 'TQB',
  2: 'RB',
  3: 'RB/WR',
  4: 'WR',
  5: 'WR/TE',
  6: 'TE',
  7: 'OP',
  16: 'D/ST',
  17: 'K',
  20: 'Bench',
  21: 'IR',
  23: 'RB/WR/TE'
};

const proTeamIdToAbbreviation = {
  '-1': 'BYE',
  1: 'ATL',
  2: 'BUF',
  3: 'CHI',
  4: 'CIN',
  5: 'CLE',
  6: 'DAL',
  7: 'DEN',
  8: 'DET',
  9: 'GB',
  10: 'TEN',
  11: 'IND',
  12: 'KC',
  13: 'LV',
  14: 'LAR',
  15: 'MIA',
  16: 'MIN',
  17: 'NE',
  18: 'NO',
  19: 'NYG',
  20: 'NYJ',
  21: 'PHI',
  22: 'ARI',
  23: 'PIT',
  24: 'LAC',
  25: 'SF',
  26: 'SEA',
  27: 'TB',
  28: 'WSH',
  29: 'CAR',
  30: 'JAX',
  33: 'BAL',
  34: 'HOU'
};

module.exports = { positionIdToName, slotIdToPosition, proTeamIdToAbbreviation };
