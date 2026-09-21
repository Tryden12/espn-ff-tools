const axios = require('axios');
const config = require('./config');

async function getMyTeamId() {
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${config.seasonId}/segments/0/leagues/${config.leagueId}`;

  const response = await axios.get(url, {
    params: { view: 'mTeam' },
    headers: { Cookie: `espn_s2=${config.espnS2}; SWID=${config.swid}` }
  });

  const teams = response.data?.teams ?? [];
  const myTeam = teams.find((team) =>
    (team.owners ?? []).some((owner) => owner.toUpperCase() === config.swid.toUpperCase())
  );

  if (!myTeam) {
    throw new Error('Could not find a team owned by the SWID configured in .env. Double-check ESPN_S2/SWID.');
  }

  return { id: myTeam.id, name: myTeam.name };
}

module.exports = { getMyTeamId };
