const express = require('express');
const { renderHomePage } = require('./pages/home');
const { renderTeamPage } = require('./pages/team');
const { renderLineupPage } = require('./pages/lineup');
const { renderWaiversPage } = require('./pages/waivers');
const { renderTradesPage } = require('./pages/trades');
const { renderLayout, escapeHtml } = require('./layout');

const PORT = process.env.PORT ?? 3000;

const app = express();

function asyncRoute(renderPage) {
  return async (req, res) => {
    try {
      const html = await renderPage(req);
      res.send(html);
    } catch (error) {
      res.status(500).send(
        renderLayout({
          title: 'Error',
          activePath: req.path,
          body: `<div class="error"><strong>Something went wrong:</strong> ${escapeHtml(error.message)}</div>`
        })
      );
    }
  };
}

app.get('/', (req, res) => res.send(renderHomePage()));

app.get(
  '/team',
  asyncRoute((req) => renderTeamPage({ week: req.query.week ? Number(req.query.week) : undefined }))
);

app.get(
  '/lineup',
  asyncRoute((req) => renderLineupPage({ week: req.query.week ? Number(req.query.week) : undefined }))
);

app.get(
  '/waivers',
  asyncRoute((req) =>
    renderWaiversPage({
      position: req.query.position || undefined,
      sort: req.query.sort || undefined,
      dir: req.query.dir || undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      week: req.query.week ? Number(req.query.week) : undefined
    })
  )
);

app.get('/trades', (req, res) => res.send(renderTradesPage()));

app.listen(PORT, () => {
  console.log(`ESPN FF Tools web UI running at http://localhost:${PORT}`);
});
