const { chromium } = require('@playwright/test');
const { test } = require('@playwright/test');
// Better: run the actual flow through Playwright's own speculos fixture by requiring the package fixture config pieces.
// Simplest: run the suite normally (managed container mode) but capture what the device screen shows during connect.
const { createSpeculosController } = require('/Users/pointcoexpedro/Dev/Web3/soulvault/node_modules/.pnpm/node_modules/@soulvault/dmk-speculos-browser/src/test.ts');
(async () => {
  const controller = createSpeculosController({ apiUrl: 'http://127.0.0.1:5000', timeoutMs: 30000 });
  const screen = async () => {
    const res = await fetch('http://127.0.0.1:5000/events?currentscreenonly=true');
    const p = await res.json();
    return (p.events || []).map((e) => e.text).join(' | ');
  };
  console.log('initial:', await screen());
  // press right and watch for 30s while a DMK client would connect
})();
