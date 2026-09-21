const { renderLayout } = require('../layout');

function renderTradesPage() {
  const body = `
    <div class="card">
      <h2>Trade Recommendations</h2>
      <p class="muted">Coming soon.</p>
    </div>
  `;

  return renderLayout({ title: 'Trade Recommendations', activePath: '/trades', body });
}

module.exports = { renderTradesPage };
