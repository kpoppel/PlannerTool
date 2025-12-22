import { expect } from '@open-wc/testing';

// This integration test assumes a local dev server is running at http://localhost:8001
describe.skip('FeatureBoard drag & resize (integration)', function(){
  this.timeout(20000);

  it('drags a feature card and triggers update', async () => {
    const url = 'http://localhost:8001/';
    const browser = await playwrightLauncher.launch({ browserName: 'chromium' });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url);

    // Wait for lit components to render
    await page.waitForSelector('feature-card-lit', { timeout: 5000 });

    // Pick the first feature card
    const card = await page.$('feature-card-lit');
    expect(card).to.exist;

    // Get initial left value
    const initialLeft = await page.evaluate(el => getComputedStyle(el).left, card);

    // Perform a drag: mouse down, move, up
    const box = await card.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();

    // Wait a short time for update to propagate
    await page.waitForTimeout(300);

    const finalLeft = await page.evaluate(el => getComputedStyle(el).left, card);
    expect(finalLeft).to.not.equal(initialLeft);

    await browser.close();
  });
});
