require('dotenv').config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

module.exports = {
  leagueId: requireEnv('LEAGUE_ID'),
  seasonId: Number(requireEnv('SEASON_ID')),
  espnS2: requireEnv('ESPN_S2'),
  swid: requireEnv('SWID')
};
