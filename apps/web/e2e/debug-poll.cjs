const { chromium } = require('@playwright/test');
const { spawn, execSync } = require('node:child_process');

// Capture the device screen continuously while the Charlie test runs.
(async () => {
  const poll = setInterval(async () => {
    try {
      const res = await fetch('http://127.0.0.1:5000/events?currentscreenonly=true');
      const p = await res.json();
      const text = (p.events || []).map((e) => e.text).join(' | ');
      if (text) console.log(new Date().toISOString().slice(11, 19), '::', text);
    } catch { /* not up yet */ }
  }, 700);
  process.on('SIGINT', () => { clearInterval(poll); process.exit(0); });
  // run for 3 minutes
  setTimeout(() => { clearInterval(poll); process.exit(0); }, 180_000);
})();
