const puppeteer = require('puppeteer-core');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const UI_URL = 'http://127.0.0.1:5173';

async function test() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.goto(UI_URL, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 2500));

  // Find and click the button
  const clicked = await page.evaluate(() => {
    const msgs = Array.from(document.querySelectorAll('main .group'));
    const target = msgs.reverse().find((m) => m.innerText.includes('Security invariant'));
    if (!target) return false;
    const quoteBtn = target.querySelector('button[title*="Quote"]');
    if (!quoteBtn) return false;
    quoteBtn.click();
    return true;
  });

  console.log('Button clicked:', clicked);

  // Wait 300ms for React state render
  await new Promise((r) => setTimeout(r, 300));

  const val = await page.evaluate(() => {
    const inp = document.querySelector('input[type="text"]');
    return inp ? inp.value : '';
  });

  console.log('Input value after React re-render:\n', val);
  await browser.close();
}

test();
