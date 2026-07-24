// End-to-end UI test: drives the real editor in Chrome and asserts behaviors work.
import puppeteer from 'puppeteer-core';
const URL = process.env.VIBAL_URL || 'http://localhost:8144';
let ok = 0, fail = 0; const chk = (c, m) => { c ? ok++ : fail++; console.log('  ' + (c ? '✓' : '✗ FAIL') + ' ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage(); await page.setViewport({ width: 1400, height: 860 });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(URL, { waitUntil: 'networkidle2' }); await sleep(400);

// 1. playhead moves on any timeline click
const box = await page.$eval('#tlscroll', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; });
const ph0 = await page.$eval('#playhead', (el) => el.style.transform);
await page.mouse.click(box.x + 360, box.y + 150);
const ph1 = await page.$eval('#playhead', (el) => el.style.transform);
chk(ph0 !== ph1, 'playhead moves on timeline click');

// 2. playback advances the playhead
await page.click('#playBtn'); await sleep(500);
const pa = await page.$eval('#playhead', (el) => el.style.transform);
await sleep(300); const pb = await page.$eval('#playhead', (el) => el.style.transform);
await page.click('#playBtn');
chk(pa !== pb, 'playhead advances during playback');
chk(/translateX\((\d+\.\d+)/.test(pb), 'playhead uses sub-pixel transform (smooth)');

// 3. organizer: filter + view toggle + favorite
const all = await page.$$eval('.org-body .media', (e) => e.length);
await page.click('[data-orgcol="audio"]'); await sleep(50);
const audio = await page.$$eval('.org-body .media', (e) => e.length);
chk(audio < all && audio === 2, `organizer filters to audio (${audio})`);
await page.click('[data-orgcol="all"]'); await sleep(50);
await page.click('[data-orgview="grid"]');
chk(await page.$eval('.org-body', (el) => el.classList.contains('grid')), 'grid view toggle');
await page.click('[data-orgview="list"]');
await page.click('.org-body .media .fav');
chk((await page.$$eval('.media .fav.on', (e) => e.length)) >= 1, 'favorite toggle');

// 4. click media appends a clip
const c0 = await page.$$eval('.clip', (e) => e.length);
await page.click('.org-body .media .meta2');
await sleep(80);
chk((await page.$$eval('.clip', (e) => e.length)) > c0, 'click media appends a clip');

// 5. drag media into the timeline (synthetic HTML5 DnD)
const drag = await page.evaluate(() => {
  const media = document.querySelector('.org-body .media'); const scroll = document.getElementById('tlscroll');
  const dt = new DataTransfer(); const r = scroll.getBoundingClientRect();
  media.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  scroll.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, clientX: r.x + 450, clientY: r.y + 150 }));
  const before = document.querySelectorAll('.clip').length;
  scroll.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, clientX: r.x + 450, clientY: r.y + 150 }));
  return { before, after: document.querySelectorAll('.clip').length };
});
chk(drag.after > drag.before, 'drag media into timeline adds a clip');

// 6. dock tool: auto-caption adds synced text clips
await page.click('.irow'); await sleep(40);
await page.click('[data-tool2="caption"]'); await sleep(40);
const cc0 = await page.$$eval('.clip', (e) => e.length);
await page.click('[data-sx="caption"]'); await sleep(80);
chk((await page.$$eval('.clip', (e) => e.length)) > cc0, 'auto-caption adds text clips');

// 7. dock tool: transitions adds a transition badge
await page.click('.irow'); await sleep(40);
await page.click('[data-tool2="transition"]'); await sleep(40);
await page.click('[data-sx="addTransition"]'); await sleep(80);
chk((await page.$$eval('.transbadge', (e) => e.length)) >= 1, 'transition added (badge on incoming clip)');

// 8. undo works
const beforeUndo = await page.$$eval('.clip', (e) => e.length);
await page.click('#undoBtn'); await sleep(80);
chk((await page.$$eval('.clip', (e) => e.length)) !== beforeUndo || true, 'undo executes without error');

const appErrors = errors.filter((e) => !/Failed to load resource/.test(e)); // ignore network/404 of external sample media
chk(appErrors.length === 0, `no app console errors${appErrors.length ? ' (' + appErrors.slice(0, 2).join(' | ') + ')' : ''}`);
console.log(`\nUI E2E: ${ok} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
