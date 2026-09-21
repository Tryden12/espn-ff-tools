const { Client } = require('espn-fantasy-football-api/node');
const config = require('./config');

function createClient() {
  return new Client({
    leagueId: config.leagueId,
    espnS2: config.espnS2,
    SWID: config.swid
  });
}

module.exports = { createClient };
