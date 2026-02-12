const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('https://8080-ifp2fakdkyjum8czewus5-b9b802c4.sandbox.novita.ai/domain-analysis-ui.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'prototype/screenshot-v2-table.png', fullPage: true });
  await browser.close();
  console.log('Done');
})();
