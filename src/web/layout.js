function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const NAV_ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/team', label: 'My Team' },
  { href: '/lineup', label: 'Lineup Optimizer' },
  { href: '/waivers', label: 'Waiver Wire' },
  { href: '/trades', label: 'Trade Recommendations' }
];

function renderLayout({ title, activePath, body }) {
  const nav = NAV_ITEMS.map(
    (item) =>
      `<a href="${item.href}" class="nav-link${item.href === activePath ? ' active' : ''}">${item.label}</a>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)} — ESPN FF Tools</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0;
      background: #0f1115;
      color: #e6e6e6;
    }
    header {
      background: #161a20;
      border-bottom: 1px solid #262b33;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      gap: 24px;
      flex-wrap: wrap;
    }
    header h1 { font-size: 18px; margin: 0; color: #f5f5f5; }
    nav { display: flex; gap: 4px; flex-wrap: wrap; }
    .nav-link {
      color: #a9b1bd;
      text-decoration: none;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
    }
    .nav-link:hover { background: #232833; color: #fff; }
    .nav-link.active { background: #2f6fed; color: #fff; }
    main { padding: 24px; max-width: 1200px; margin: 0 auto; }
    h2 { color: #f5f5f5; }
    table { border-collapse: collapse; width: 100%; margin-top: 12px; font-size: 14px; }
    th, td { padding: 8px 10px; border-bottom: 1px solid #262b33; text-align: left; white-space: nowrap; }
    th { color: #a9b1bd; font-weight: 600; position: sticky; top: 0; background: #0f1115; }
    tr:hover td { background: #171b22; }
    .card {
      background: #161a20;
      border: 1px solid #262b33;
      border-radius: 10px;
      padding: 20px;
      margin-bottom: 16px;
    }
    .menu-table td { padding: 14px 16px; }
    .menu-table a { color: #6fa8ff; text-decoration: none; font-weight: 600; }
    .menu-table a:hover { text-decoration: underline; }
    .menu-table .desc { color: #a9b1bd; }
    .muted { color: #7c8593; font-size: 13px; }
    form.filters { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; margin-bottom: 16px; }
    form.filters label { display: flex; flex-direction: column; font-size: 12px; color: #a9b1bd; gap: 4px; }
    form.filters input, form.filters select {
      background: #0f1115; color: #e6e6e6; border: 1px solid #333a45; border-radius: 6px; padding: 6px 8px;
    }
    form.filters button {
      background: #2f6fed; color: #fff; border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer;
    }
    .pill { padding: 2px 8px; border-radius: 999px; background: #232833; font-size: 12px; }
    .pill.boost { background: #2f6f4a; color: #b9f6ca; }
    .error { background: #4a1f24; border: 1px solid #7a2c33; color: #ffb4bc; padding: 16px; border-radius: 8px; }
    .oprk-tough { color: #ff6b6b; font-weight: 600; }
    .oprk-easy { color: #4fd17a; font-weight: 600; }
  </style>
</head>
<body>
  <header>
    <h1>ESPN FF Tools</h1>
    <nav>${nav}</nav>
  </header>
  <main>${body}</main>
</body>
</html>`;
}

// OPRK 1-32: 1 = toughest matchup for the position, 32 = easiest. Flag the
// top 10 toughest matchups red and the bottom 10 (i.e. easiest 10) green.
const OPRK_TOP_THRESHOLD = 10;
const OPRK_BOTTOM_THRESHOLD = 23; // 32 - 10 + 1

function oprkClass(rank) {
  if (rank === null || rank === undefined) return '';
  if (rank <= OPRK_TOP_THRESHOLD) return 'oprk-tough';
  if (rank >= OPRK_BOTTOM_THRESHOLD) return 'oprk-easy';
  return '';
}

module.exports = { renderLayout, escapeHtml, oprkClass };
