const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('./config');

// FantasyCalc's API docs ask that /values/current be refreshed at most once
// an hour, and their terms prefer once a day. 12 hours keeps values fresh
// enough to reflect Sunday injuries without hammering their API.
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_DIR = path.join(__dirname, '..', '.cache');

const ATTRIBUTION_URL = 'https://fantasycalc.com';
const SUPPORTED_TEAM_COUNTS = [8, 10, 12, 14];
const SUPPORTED_PPR = [0, 0.5, 1];
const RECEPTIONS_STAT_ID = 53;

function nearest(value, options) {
  return options.reduce((best, option) => (Math.abs(option - value) < Math.abs(best - value) ? option : best));
}

async function fetchLeagueSettings(seasonId) {
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${seasonId}/segments/0/leagues/${config.leagueId}`;
  const response = await axios.get(url, {
    params: { view: 'mSettings' },
    headers: { Cookie: `espn_s2=${config.espnS2}; SWID=${config.swid}` }
  });
  return response.data.settings;
}

// FantasyCalc values depend on league format, so derive it from the ESPN
// league itself rather than hardcoding. Superflex = an OP slot or 2+ QB slots.
async function getLeagueFormat(seasonId) {
  const settings = await fetchLeagueSettings(seasonId);
  const slots = settings.rosterSettings.lineupSlotCounts;
  const receptions = settings.scoringSettings.scoringItems.find((item) => item.statId === RECEPTIONS_STAT_ID);

  return {
    numTeams: nearest(settings.size, SUPPORTED_TEAM_COUNTS),
    numQbs: (slots['7'] ?? 0) > 0 || (slots['0'] ?? 0) >= 2 ? '2' : '1',
    ppr: nearest(receptions?.points ?? 0, SUPPORTED_PPR)
  };
}

function readCache(cacheFile) {
  try {
    const stat = fs.statSync(cacheFile);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch {
    return null;
  }
}

async function fetchCurrentValues({ numTeams, numQbs, ppr }) {
  const cacheFile = path.join(CACHE_DIR, `fantasycalc-redraft-${numTeams}t-${numQbs}qb-${ppr}ppr.json`);
  const cached = readCache(cacheFile);
  if (cached) return cached;

  const response = await axios.get('https://api.fantasycalc.com/values/current', {
    params: { isDynasty: false, numQbs, numTeams, ppr }
  });
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(response.data));
  return response.data;
}

// Redraft trade values keyed by ESPN player id, which is the same id our
// ESPN roster data uses, so no name matching is needed. FantasyCalc only
// covers QB/RB/WR/TE — K and D/ST are never present.
async function loadTradeValues(seasonId) {
  const format = await getLeagueFormat(seasonId);
  const entries = await fetchCurrentValues(format);

  const byEspnId = new Map();
  entries.forEach((entry) => {
    if (!entry.player.espnId) return;
    byEspnId.set(Number(entry.player.espnId), {
      value: entry.value,
      overallRank: entry.overallRank,
      positionRank: entry.positionRank,
      trend30Day: entry.trend30Day ?? 0
    });
  });

  return { format, byEspnId };
}

module.exports = { loadTradeValues, ATTRIBUTION_URL };
