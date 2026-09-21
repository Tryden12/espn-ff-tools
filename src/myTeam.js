const axios = require('axios');
const config = require('./config');

async function fetchTeams() {
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${config.seasonId}/segments/0/leagues/${config.leagueId}`;

  const response = await axios.get(url, {
    params: { view: 'mTeam' },
    headers: { Cookie: `espn_s2=${config.espnS2}; SWID=${config.swid}` }
  });

  return response.data?.teams ?? [];
}

async function getMyTeamId() {
  const teams = await fetchTeams();
  const myTeam = teams.find((team) =>
    (team.owners ?? []).some((owner) => owner.toUpperCase() === config.swid.toUpperCase())
  );

  if (!myTeam) {
    throw new Error('Could not find a team owned by the SWID configured in .env. Double-check ESPN_S2/SWID.');
  }

  return { id: myTeam.id, name: myTeam.name };
}

async function getAllTeams() {
  const teams = await fetchTeams();
  return teams.map((team) => ({ id: team.id, name: team.name }));
}

module.exports = { getMyTeamId, getAllTeams };
