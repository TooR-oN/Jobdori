const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('https://8080-ifp2fakdkyjum8czewus5-b9b802c4.sandbox.novita.ai/domain-analysis-ui.html');
  await page.waitForTimeout(5000);

  // Screenshot 1: Report tab
  await page.click('#tab-report');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'prototype/screenshot-report.png', fullPage: true });
  
  // Screenshot 2: Running state
  await page.click('#tab-table'); // reset
  await page.evaluate(() => showState('running'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'prototype/screenshot-running.png' });
  
  // Screenshot 3: No data state
  await page.evaluate(() => showState('nodata'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'prototype/screenshot-nodata.png' });
  
  // Screenshot 4: Error state
  await page.evaluate(() => showState('error'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'prototype/screenshot-error.png' });

  // Screenshot 5: Modal
  await page.evaluate(() => showState('completed'));
  await page.waitForTimeout(500);
  await page.evaluate(() => openModal('toonkor.com'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'prototype/screenshot-modal.png', fullPage: true });

  await browser.close();
  console.log('All screenshots taken');
})();
