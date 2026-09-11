const { execFileSync } = require('node:child_process');
const API = process.env.SOULVAULT_SPECULOS_API_URL || 'http://127.0.0.1:5000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function screen() {
  const res = await fetch(`${API}/events?currentscreenonly=true`);
  const payload = await res.json();
  return (payload.events || []).map((e) => e.text).join(' | ');
}

(async () => {
  console.log('home screen:', await screen());
  // Press right a few times and observe
  for (let i = 0; i < 10; i++) {
    await fetch('http://127.0.0.1:5000/button/right', { method: 'POST', body: '{"action":"press-and-release"}' });
    await sleep(300);
    process.stdout.write(i + ': ' + await screen() + '\n');
  }
})();
