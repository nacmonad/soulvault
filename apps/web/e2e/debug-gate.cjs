const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', (m) => { const t = m.text(); if (t.length) console.log('[c]', m.type(), t.slice(0, 250)); });
  page.on('pageerror', (e) => console.log('[pageerror]', (e.stack || e.message).slice(0, 400)));
  // Point apduUrl at the real speculos container's HTTP API. Browsers can't hit loopback directly...
  // per the skill: browsers must use the bridge URLs. But the fixture's apduUrl is a worker-side bridge.
  // In the dashboard gate we pass apduUrl directly — the same thing the proof page does (bridge URL from fixture, CORS-enabled).
  // Reuse the package bridge? The fixture starts its own bridge. Our page just needs an APDU endpoint with CORS.
  // For THIS debug run: skip transport; verify only that the gate reads the param.
  await page.goto('http://127.0.0.1:3100/dashboard?apduUrl=http://127.0.0.1:9999');
  await page.waitForTimeout(3000);
  console.log('gate transport loaded?', await page.evaluate(() => window.__speculos || 'unknown'));
  await browser.close();
})().catch((e) => { console.log('FATAL', e.message); process.exit(1); });
