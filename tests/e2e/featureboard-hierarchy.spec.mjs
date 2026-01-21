import { test, expect } from '@playwright/test';
// Run : PWDEBUG=1 npx playwright test tests/e2e/featureboard-hierarchy.spec.mjs --headed
// 

// This test mocks /api/tasks and returns several task constellations to
// exercise Feature/Epic parent/child relationships including cross-area and
// circular references. The test simply loads the app and verifies it doesn't
// crash and that the tasks endpoint was requested.

// The real `/api/tasks` returns an array of work-items where each item may
// include a `relations` array. The frontend expects `type` (lowercase),
// `project` (slugified id), and `relations: [{ type: 'Parent', id }]` when a
// parent exists. Build the payload as an array to match the server shape.
const tasksPayload = [
  // 1. Epic top-level, Feature child, same project -> OK
  { id: 100, type: 'epic', title: 'Epic TL same', assignee: 'Alice', state: 'New', tags: 'Epic', description: 'Epic description', startDate: '2025-01-01', finishDate: '2025-06-30', areaPath: 'ProjectA\\Team1', iterationPath: 'ProjectA', relations: [], url: 'https://example/100', project: 'project-projecta', start: '2025-01-01', end: '2025-06-30', capacity: [{ team: 'team-team1', capacity: 80 }] },
  { id: 101, type: 'feature', title: 'Feature child same', assignee: 'Bob', state: 'Active', tags: 'Feature', description: 'Feature description', startDate: '2025-02-01', finishDate: '2025-03-01', areaPath: 'ProjectA\\Team1', iterationPath: 'ProjectA', relations: [{ type: 'Parent', id: 100, url: 'https://example/100' }], url: 'https://example/101', project: 'project-projecta', start: '2025-02-01', end: '2025-03-01', capacity: [{ team: 'team-team1', capacity: 40 }] },

  // 2. Epic top-level, Feature child from different project -> OK
  { id: 200, type: 'epic', title: 'Epic TL cross', assignee: 'Carol', state: 'New', tags: 'Epic', description: 'Cross epic', startDate: '2025-01-10', finishDate: '2025-05-10', areaPath: 'ProjectA\\Team1', iterationPath: 'ProjectA', relations: [], url: 'https://example/200', project: 'project-projecta', start: '2025-01-10', end: '2025-05-10', capacity: [{ team: 'team-team1', capacity: 80 }] },
  { id: 201, type: 'feature', title: 'Feature child cross', assignee: 'Dan', state: 'Active', tags: 'Feature', description: 'Cross-area feature', startDate: '2025-02-10', finishDate: '2025-03-10', areaPath: 'ProjectB\\Team2', iterationPath: 'ProjectB', relations: [{ type: 'Parent', id: 200, url: 'https://example/200' }], url: 'https://example/201', project: 'project-projectb', start: '2025-02-10', end: '2025-03-10', capacity: [{ team: 'team-team2', capacity: 30 }] },

  // 3. Epic_1 -> Feature_1 -> Epic_2 -> Feature_2 (nested alternating types) -> 302 and 301 not connected. Size and move as separate pairs.
  { id: 300, type: 'epic', title: 'Epic_1', assignee: 'Eve', state: 'New', tags: 'Epic', description: 'Nested epic 1', startDate: '2025-03-01', finishDate: '2025-08-01', areaPath: 'ProjectA\\Team1', iterationPath: 'ProjectA', relations: [], url: 'https://example/300', project: 'project-projecta', start: '2025-03-01', end: '2025-08-01', capacity: [{ team: 'team-team1', capacity: 90 }] },
  { id: 301, type: 'feature', title: 'Feature_1', assignee: 'Frank', state: 'Active', tags: 'Feature', description: 'Nested feature 1', startDate: '2025-03-15', finishDate: '2025-04-15', areaPath: 'ProjectA\\Team1', iterationPath: 'ProjectA', relations: [{ type: 'Parent', id: 300, url: 'https://example/300' }], url: 'https://example/301', project: 'project-projecta', start: '2025-03-15', end: '2025-04-15', capacity: [{ team: 'team-team1', capacity: 45 }] },
  { id: 302, type: 'epic', title: 'Epic_2', assignee: 'Gina', state: 'New', tags: 'Epic', description: 'Nested epic 2', startDate: '2025-04-01', finishDate: '2025-06-01', areaPath: 'ProjectA\\Team1', iterationPath: 'ProjectA', relations: [{ type: 'Parent', id: 301, url: 'https://example/301' }], url: 'https://example/302', project: 'project-projecta', start: '2025-04-01', end: '2025-06-01', capacity: [{ team: 'team-team1', capacity: 70 }] },
  { id: 303, type: 'feature', title: 'Feature_2', assignee: 'Hank', state: 'Active', tags: 'Feature', description: 'Nested feature 2', startDate: '2025-04-15', finishDate: '2025-05-15', areaPath: 'ProjectA\\Team1', iterationPath: 'ProjectA', relations: [{ type: 'Parent', id: 302, url: 'https://example/302' }], url: 'https://example/303', project: 'project-projecta', start: '2025-04-15', end: '2025-05-15', capacity: [{ team: 'team-team1', capacity: 35 }] },

  // 4. Epic top-level, Epic child same project -> Epics move together but sizing is off
  { id: 400, type: 'epic', title: 'Epic parent', assignee: 'Ivy', state: 'New', tags: 'Epic', description: 'Epic parent', startDate: '2025-05-01', finishDate: '2025-09-01', areaPath: 'ProjectA\\Team1', iterationPath: 'ProjectA', relations: [], url: 'https://example/400', project: 'project-projecta', start: '2025-05-01', end: '2025-09-01', capacity: [{ team: 'team-team1', capacity: 100 }] },
  { id: 401, type: 'epic', title: 'Epic child same', assignee: 'Jake', state: 'Active', tags: 'Epic', description: 'Epic child same', startDate: '2025-06-01', finishDate: '2025-07-01', areaPath: 'ProjectA\\Team1', iterationPath: 'ProjectA', relations: [{ type: 'Parent', id: 400, url: 'https://example/400' }], url: 'https://example/401', project: 'project-projecta', start: '2025-06-01', end: '2025-07-01', capacity: [{ team: 'team-team1', capacity: 50 }] },

  // 5. Epic top-level, Epic from different project -> Epics move together but sizing is off
  { id: 500, type: 'epic', title: 'Epic parent cross', assignee: 'Kim', state: 'New', tags: 'Epic', description: 'Epic parent cross', startDate: '2025-07-01', finishDate: '2025-10-01', areaPath: 'ProjectA\\Team1', iterationPath: 'ProjectA', relations: [], url: 'https://example/500', project: 'project-projecta', start: '2025-07-01', end: '2025-10-01', capacity: [{ team: 'team-team1', capacity: 85 }] },
  { id: 501, type: 'epic', title: 'Epic child cross', assignee: 'Liam', state: 'Active', tags: 'Epic', description: 'Epic child cross', startDate: '2025-07-15', finishDate: '2025-08-15', areaPath: 'ProjectB\\Team2', iterationPath: 'ProjectB', relations: [{ type: 'Parent', id: 500, url: 'https://example/500' }], url: 'https://example/501', project: 'project-projectb', start: '2025-07-15', end: '2025-08-15', capacity: [{ team: 'team-team2', capacity: 35 }] },

  // 6. Feature top-level, Feature child same project -> 601 not rendered
  { id: 600, type: 'feature', title: 'Feature TL', assignee: 'Mona', state: 'New', tags: 'Feature', description: 'Feature TL', startDate: '2025-09-01', finishDate: '2025-09-30', areaPath: 'ProjectA\\Team1', iterationPath: 'ProjectA', relations: [], url: 'https://example/600', project: 'project-projecta', start: '2025-09-01', end: '2025-09-30', capacity: [{ team: 'team-team1', capacity: 40 }] },
  { id: 601, type: 'feature', title: 'Feature child same2', assignee: 'Nate', state: 'Active', tags: 'Feature', description: 'Feature child same2', startDate: '2025-09-05', finishDate: '2025-09-20', areaPath: 'ProjectA\\Team1', iterationPath: 'ProjectA', relations: [{ type: 'Parent', id: 600, url: 'https://example/600' }], url: 'https://example/601', project: 'project-projecta', start: '2025-09-05', end: '2025-09-20', capacity: [{ team: 'team-team1', capacity: 20 }] },

  // 7. Feature top-level, Feature from different project -> 701 not rendered
  { id: 700, type: 'feature', title: 'Feature TL cross', assignee: 'Olga', state: 'New', tags: 'Feature', description: 'Feature TL cross', startDate: '2025-10-01', finishDate: '2025-10-31', areaPath: 'ProjectA\\Team1', iterationPath: 'ProjectA', relations: [], url: 'https://example/700', project: 'project-projecta', start: '2025-10-01', end: '2025-10-31', capacity: [{ team: 'team-team1', capacity: 40 }] },
  { id: 701, type: 'feature', title: 'Feature child cross2', assignee: 'Pete', state: 'Active', tags: 'Feature', description: 'Feature child cross2', startDate: '2025-10-05', finishDate: '2025-10-20', areaPath: 'ProjectB\\Team2', iterationPath: 'ProjectB', relations: [{ type: 'Parent', id: 700, url: 'https://example/700' }], url: 'https://example/701', project: 'project-projectb', start: '2025-10-05', end: '2025-10-20', capacity: [{ team: 'team-team2', capacity: 30 }] },

  // 8. Circular reference: Epic_1 -> Feature_1 -> Epic_2 -> Epic_1 -> 802 not connected to 801 so they don't move together
  { id: 800, type: 'epic', title: 'Circ_Epic_1', assignee: 'Quinn', state: 'New', tags: 'Epic', description: 'Circ epic 1', startDate: '2025-11-01', finishDate: '2025-12-01', areaPath: 'ProjectA\\Team1', iterationPath: 'ProjectA', relations: [{ type: 'Parent', id: 803, url: 'https://example/803' }], url: 'https://example/800', project: 'project-projecta', start: '2025-11-01', end: '2025-12-01', capacity: [{ team: 'team-team1', capacity: 75 }] },
  { id: 801, type: 'feature', title: 'Circ_Feature_1', assignee: 'Rita', state: 'Active', tags: 'Feature', description: 'Circ feature 1', startDate: '2025-11-05', finishDate: '2025-11-20', areaPath: 'ProjectA\\Team1', iterationPath: 'ProjectA', relations: [{ type: 'Parent', id: 800, url: 'https://example/800' }], url: 'https://example/801', project: 'project-projecta', start: '2025-11-05', end: '2025-11-20', capacity: [{ team: 'team-team1', capacity: 35 }] },
  { id: 802, type: 'epic', title: 'Circ_Epic_2', assignee: 'Sam', state: 'New', tags: 'Epic', description: 'Circ epic 2', startDate: '2025-11-10', finishDate: '2025-11-30', areaPath: 'ProjectA\\Team1', iterationPath: 'ProjectA', relations: [{ type: 'Parent', id: 801, url: 'https://example/801' }], url: 'https://example/802', project: 'project-projecta', start: '2025-11-10', end: '2025-11-30', capacity: [{ team: 'team-team1', capacity: 50 }] },
  // loop back to 800
  { id: 803, type: 'epic', title: 'Circ_Epic_1_loop', assignee: 'Tara', state: 'Active', tags: 'Epic', description: 'Circ epic loop', startDate: '2025-11-15', finishDate: '2025-12-05', areaPath: 'ProjectA\\Team1', iterationPath: 'ProjectA', relations: [{ type: 'Parent', id: 802, url: 'https://example/802' }], url: 'https://example/803', project: 'project-projecta', start: '2025-11-15', end: '2025-12-05', capacity: [] }
];

const projectsPayload = [
  { id: 'project-projecta', name: 'ProjectA', type: 'project' },
  { id: 'project-projectb', name: 'ProjectB', type: 'project' }
];

const teamsPayload = [
  { id: 'team-team1', name: 'Team1', short_name: 'T1' },
  { id: 'team-team2', name: 'Team2', short_name: 'T2' }
];

test('FeatureBoard handles various parent-child constellations without crashing', async ({ page }) => {
  let tasksRequested = false;

  // Intercept projects and teams APIs so the UI can resolve area/team names
  await page.route('**/api/projects', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(projectsPayload),
    });
  });

  await page.route('**/api/teams', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(teamsPayload),
    });
  });

  // Intercept the tasks API and return our crafted payload
  await page.route('**/api/tasks', route => {
    tasksRequested = true;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(tasksPayload),
    });
  });

  // Go to the app root (adjust if app mounts at a different page)
  await page.goto('http://localhost:8000/');
  await page.pause()
  // Wait a short time for the app to initialize and request the tasks
  await page.waitForTimeout(1000);

  expect(tasksRequested).toBeTruthy();

  // Basic smoke check: ensure the app's main element exists (adjust selector as needed)
  const main = await page.$('body');
  expect(main).not.toBeNull();

  // Optionally dump some debug output to the test log
  console.log('Mocked /api/tasks served. Payload length:', tasksPayload.length);
});
