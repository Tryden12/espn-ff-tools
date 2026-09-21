const { renderLayout } = require('../layout');

const MENU_ITEMS = [
  { href: '/team', label: 'My Team', desc: 'Your current roster, positions, and matchups.' },
  { href: '/lineup', label: 'Lineup Optimizer', desc: 'The exact best lineup given this week’s projections.' },
  { href: '/waivers', label: 'Waiver Wire Recommendations', desc: 'Ranked free agents with matchup and opportunity context.' },
  { href: '/trades', label: 'Trade Recommendations', desc: 'Position strength, suggested trades, handcuff chips, and buy-low/sell-high signals.' }
];

function renderHomePage() {
  const rows = MENU_ITEMS.map((item) => {
    const label = item.disabled
      ? `<span class="muted">${item.label}</span>`
      : `<a href="${item.href}">${item.label}</a>`;
    return `<tr><td>${label}</td><td class="desc">${item.desc}</td></tr>`;
  }).join('');

  const body = `
    <div class="card">
      <h2>What do you want to look at?</h2>
      <table class="menu-table">
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  return renderLayout({ title: 'Home', activePath: '/', body });
}

module.exports = { renderHomePage };
