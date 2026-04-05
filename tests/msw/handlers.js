import { http, HttpResponse } from 'msw';

// Minimal realistic fixtures used by many components. Tests may override handlers
// per-test using `server.use(...)` to scope responses.
const health = {
  status: 'ok',
  start_time: '2026-04-01T07:42:05.989527+00:00',
  uptime_seconds: 4252,
  version: 'v3.0.0',
  server_name: 'prod',
};

const session = { sessionId: 'e0a29ba9fc36494393fe9c1afa6fb609' };

const projects = [
  {
    id: 'project-a',
    name: 'Proj A',
    type: 'project',
    display_states: ['New', 'Active', 'Defined', 'Resolved', 'Closed'],
    task_types: ['epic', 'feature'],
  },
  {
    id: 'project-b',
    name: 'Proj B',
    type: 'team',
    display_states: ['New', 'Active', 'Defined', 'Resolved', 'Closed'],
    task_types: ['epic', 'feature'],
  },
  {
    id: 'project-c',
    name: 'Proj C',
    type: 'team',
    display_states: ['New', 'Active', 'Defined', 'Resolved', 'Closed'],
    task_types: ['epic', 'feature'],
  },
];

const teams = [
  { id: 'team-t1', name: 'Team 1', short_name: 'TEA' },
  { id: 'team-t2', name: 'Team 2', short_name: 'TE2' },
  { id: 'team-t3', name: 'Team 3', short_name: 'TSS' },
];

const iterations = {
  iterations: [
    {
      path: 'my_proj\\1',
      name: 'Iter 1',
      startDate: '2025-12-29',
      finishDate: '2026-12-20',
    },
    {
      path: 'my_proj\\2',
      name: 'Iter 2',
      startDate: '2025-12-29',
      finishDate: '2026-03-20',
    },
    {
      path: 'my_proj\\3',
      name: 'Iter 3',
      startDate: '2025-12-29',
      finishDate: '2026-01-23',
    },
    {
      path: 'my_proj\\4',
      name: 'Iter 4',
      startDate: '2026-01-26',
      finishDate: '2026-02-20',
    },
  ],
};

const scenarios = [
  { id: 'scen_1773226555116_6770', user: 'bob@example.com', shared: false },
  { id: 'scen_1773457235116_6630', user: 'alice@example.com', shared: false },
];

const scenarioOverrides = {
  scen_1773226555116_6770: {
    id: 'scen_1773226555116_6770',
    name: '03-11 Scenario Bob',
    overrides: {
      1001: { capacity: [{ team: 'team-t2', capacity: 100 }] },
    },
    filters: {
      projects: ['project-a', 'project-b', 'project-c'],
      teams: ['team-t1', 'team-t2', 'team-t3'],
    },
    view: {
      capacityViewMode: 'project',
      condensedCards: false,
      featureSortMode: 'date',
      showUnassignedCards: true,
      showDependencies: false,
      showUnplannedWork: true,
      timelineScale: 'months',
      hiddenTypes: [],
      showOnlyProjectHierarchy: true,
    },
  },
  scen_1773457235116_6630: {
    id: 'scen_scen_1773457235116_6630',
    name: '05-11 Scenario Alice',
    overrides: {
      1005: { capacity: [{ team: 'team-t3', capacity: 100 }] },
    },
    filters: {
      projects: ['project-a'],
      teams: ['team-t3'],
    },
    view: {
      capacityViewMode: 'project',
      condensedCards: false,
      featureSortMode: 'date',
      showUnassignedCards: true,
      showDependencies: false,
      showUnplannedWork: true,
      timelineScale: 'months',
      hiddenTypes: [],
      showOnlyProjectHierarchy: true,
    },
  },
};

const views = [
  {
    id: '236bfedf176c441bb999324d87d15120',
    user: 'bob@example.com',
    name: 'Team A View',
  },
  {
    id: 'f13cfd50bc464598a833fc385a44d20d',
    user: 'alice@example.com',
    name: 'Team B View',
  },
];

const viewDetails = {
  '236bfedf176c441bb999324d87d15120': {
    id: '236bfedf176c441bb999324d87d15120',
    name: 'Team A View',
    selectedProjects: { 'project-a': true, 'project-b': false, 'project-c': false },
    selectedTeams: { 'team-t1': true, 'team-t2': true, 'team-t3': true },
    viewOptions: {
      capacityViewMode: 'team',
      condensedCards: false,
      featureSortMode: 'rank',
      showUnassignedCards: true,
      showDependencies: false,
      showUnplannedWork: true,
      timelineScale: 'months',
      hiddenTypes: [],
      showOnlyProjectHierarchy: false,
      selectedFeatureStates: ['New', 'Resolved', 'Active', 'Defined', 'Closed'],
      selectedTaskTypes: ['epic', 'feature'],
      graphType: 'team',
      taskFilters: {
        schedule: { planned: true, unplanned: true },
        allocation: { allocated: true, unallocated: true },
        hierarchy: { hasParent: true, noParent: true },
        relations: { hasLinks: true, noLinks: true },
      },
      expandParentChild: false,
      expandRelations: false,
      expandTeamAllocated: false,
    },
  },
  f13cfd50bc464598a833fc385a44d20d: {
    id: 'f13cfd50bc464598a833fc385a44d20d',
    name: 'Team B View',
    selectedProjects: { 'project-a': false, 'project-b': true, 'project-c': false },
    selectedTeams: { 'team-t1': false, 'team-t2': true, 'team-t3': false },
    viewOptions: {
      capacityViewMode: 'project',
      condensedCards: true,
      featureSortMode: 'date',
      showUnassignedCards: true,
      showDependencies: false,
      showUnplannedWork: true,
      timelineScale: 'months',
      hiddenTypes: [],
      showOnlyProjectHierarchy: false,
      selectedFeatureStates: ['New', 'Resolved', 'Active', 'Defined', 'Closed'],
      selectedTaskTypes: ['epic', 'feature'],
      graphType: 'team',
      taskFilters: {
        schedule: { planned: true, unplanned: true },
        allocation: { allocated: true, unallocated: true },
        hierarchy: { hasParent: true, noParent: true },
        relations: { hasLinks: true, noLinks: true },
      },
      expandParentChild: true,
      expandRelations: true,
      expandTeamAllocated: true,
    },
  },
};

const markers = [
  {
    plan_id: '11111111-5e8f-4a48-81c6-5e48b6ecee35',
    plan_name: 'Marker Plan 1',
    team_id: null,
    team_name: null,
    marker: {
      date: '2025-10-30T00:00:00Z',
      label: 'Release 1 ',
      color: '#3F9BD8',
    },
    project: 'project-a',
  },
  {
    plan_id: '59b35bef-5e8f-1111-1111-222222222222',
    plan_name: 'Marker Plan 2',
    team_id: null,
    team_name: null,
    marker: { date: '2025 - 11 - 20T00:00:00Z', label: 'Release 8', color: '#009CCC' },
    project: 'project-b',
  },
];

const costTeams = {
  teams: [
    {
      id: 'team-t1',
      name: 'Team 1',
      members: [
        {
          name: 'Bob',
          external: true,
          site: 'GRT',
          hourly_rate: 50.0,
          hours_per_month: 160,
        },
        {
          name: 'Alice',
          external: false,
          site: 'FDD',
          hourly_rate: 50.0,
          hours_per_month: 160,
        },
      ],
      totals: {
        internal_count: 1,
        external_count: 1,
        internal_hours_total: 160,
        external_hours_total: 160,
        internal_hourly_rate_total: 50.0,
        external_hourly_rate_total: 50.0,
      },
    },
    {
      id: 'team-t2',
      name: 'Team 2',
      members: [
        {
          name: 'Bob 2',
          external: false,
          site: 'FDD',
          hourly_rate: 64.0,
          hours_per_month: 116,
        },
        {
          name: 'Alice 2',
          external: false,
          site: 'FDD',
          hourly_rate: 64.0,
          hours_per_month: 116,
        },
      ],
      totals: {
        internal_count: 2,
        external_count: 0,
        internal_hours_total: 232,
        external_hours_total: 0,
        internal_hourly_rate_total: 128.0,
        external_hourly_rate_total: 0.0,
      },
    },
    {
      id: 'team-t3',
      name: 'Team 3',
      members: [
        {
          name: 'Alice 3',
          external: false,
          site: 'FDD',
          hourly_rate: 64.0,
          hours_per_month: 116,
        },
        {
          name: 'Bob 3',
          external: true,
          site: 'FDD',
          hourly_rate: 50.0,
          hours_per_month: 160,
        },
        {
          name: 'Alex',
          external: false,
          site: 'GRT',
          hourly_rate: 50.0,
          hours_per_month: 160,
        },

      ],
      totals: {
        internal_count: 3,
        external_count: 0,
        internal_hours_total: 928,
        external_hours_total: 0,
        internal_hourly_rate_total: 512.0,
        external_hourly_rate_total: 0.0,
      },
    },
  ],
};

// States used by tasks; prototype picks a random state at module load time.
const STATES = ['Closed', 'New', 'Active', 'Defined', 'Resolved'];
function randomState() {
  return STATES[Math.floor(Math.random() * STATES.length)];
}

// Random tagging
const TAG_POOL = ['TagA', 'TagB', 'TagC', 'TagD'];
function randomTags() {
  const n = Math.floor(Math.random() * (TAG_POOL.length + 1)); // 0..4 tags
  if (n === 0) return null;
  const pool = TAG_POOL.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n).join('; ');
}
function randomCapacity() {
  // 50% chance of no capacity
  if (Math.random() < 0.5) return [];
  const ids = teams.map((t) => t.id);
  const n = Math.floor(Math.random() * ids.length) + 1; // 1..ids.length
  // shuffle ids
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids
    .slice(0, n)
    .map((tid) => ({ team: tid, capacity: Math.floor(Math.random() * 100) }));
}

// Prototype and factory for tasks so tests can produce targeted variations
const taskProto = {
  id: 'T-000',
  type: 'feature',
  title: 'Prototype Task Title',
  assignee: '', // Randomize by default
  state: 'New', // Randomize by default
  tags: null, // Randomize by default
  description: null, // Randomize by default
  startDate: null,
  finishDate: null,
  areaPath: 'my_proj\\p1\\p2',
  iterationPath: 'my_proj\\i1',
  relations: [],
  url: 'https://example.com/T-000',
  project: 'project-a',
  start: null, // TODO: Really must remove the double start, startDate, end, endDate mess
  end: null,
  capacity: [],
};

function makeTask(overrides = {}) {
  const base = JSON.parse(JSON.stringify(taskProto));
  // assign a random state per invocation unless caller provided one
  if (overrides.state === undefined) {
    base.state = randomState();
  }
  // Assign random assignee
  base.assignee = ['Alice', 'Bob', ''][Math.floor(Math.random() * 3)];
  // assign a random project
  if (overrides.project === undefined) {
    base.project = projects[Math.floor(Math.random() * projects.length)].id;
  }
  // assign a random iteration
  if (overrides.iterationPath === undefined) {
    base.iterationPath = `my_proj\\i1\\${Math.floor(Math.random() * 3) + 1}`;
  }
  // assign a random area path
  if (overrides.areaPath === undefined) {
    base.areaPath = `my_proj\\p1\\p2\\${Math.floor(Math.random() * 3) + 1}`;
  }

  // assign random tags (zero or more) when caller doesn't override
  if (overrides.tags === undefined) {
    base.tags = randomTags();
  }
  // assign random capacity (empty or random per-team) when caller doesn't override
  if (overrides.capacity === undefined) {
    base.capacity = randomCapacity();
  }
  // assign random title
  if (overrides.title === undefined) {
    base.title = [`Task ${Math.floor(Math.random() * 1000)}`, null][
      Math.floor(Math.random() * 2)
    ];
  }

  Object.keys(overrides).forEach((k) => {
    base[k] = overrides[k];
  });
  return base;
}

const tasks = [
  makeTask({
    id: '100',
    state: 'Active',
    relations: [{ type: 'Parent', id: '516154', url: 'https://example.com/516154' }],
    start: null,
    end: null,
  }),
  makeTask({
    id: '101',
    state: 'New',
    _inferred_start: true,
    _inferred_end: true,
    start: '2026-02-23',
    end: '2026-03-20',
    iterationPath: 'my_proj\\i1\\1',
  }),
  makeTask({
    id: '102',
    state: 'New',
    _inferred_start: true,
    _inferred_end: true,
    start: '2026-02-23',
    end: '2026-03-20',
    iterationPath: 'my_proj\\i1\\2',
  }),
  makeTask({ id: '103', state: 'Active' }),
  makeTask({ id: '104', state: 'Resolved' }),
  makeTask({
    id: '105',
    state: 'Defined',
    _inferred_start: true,
    _inferred_end: true,
    start: '2026-02-23',
    end: '2026-03-20',
    iterationPath: 'my_proj\\i1\\3',
  }),
  makeTask({ id: '106', state: 'Active', start: '2025-08-09', end: '2025-09-08' }),
  makeTask({ id: '107', state: 'Active', start: '2025-09-06', end: '2025-10-06' }),
  makeTask({ id: '108', state: 'Active', start: '2025-08-06', end: '2025-09-05' }),
  makeTask({
    id: '109',
    type: 'epic',
    title: 'Title Text',
    assignee: 'Foo Bar',
    state: 'Active',
    start: '2025-07-04',
    end: '2025-11-13',
  }),
  makeTask({
    id: '110',
    type: 'epic',
    state: 'New',
    capacity: [{ team: 'team-t2', capacity: 100 }],
  }),
  makeTask({
    id: '111',
    type: 'epic',
    state: 'New',
    start: '2026-01-26',
    end: '2026-05-26',
    capacity: [{ team: 'team-t1', capacity: 100 }],
  }),
  makeTask({ id: '112', type: 'epic', state: 'New' }),
  makeTask({
    id: '113',
    type: 'epic',
    state: 'New',
    _inferred_start: true,
    _inferred_end: true,
    start: '2026-02-23',
    end: '2026-03-20',
    iterationPath: 'my_proj\\i1\\1',
  }),
  makeTask({ id: '114', state: 'Active', start: '2025-08-22', end: '2025-09-21' }),
];

// History generator: produce a history object from the `tasks` array.
const HISTORY_USERS = ['Alice', 'Bob'];

function randomPastDate(daysBack = 365) {
  const now = Date.now();
  const past = now - Math.floor(Math.random() * daysBack * 24 * 3600 * 1000);
  return new Date(past).toISOString();
}

function generateHistory(projectId, per_page = 500) {
  // Optionally return empty history (10% chance)
  if (Math.random() < 0.1) {
    return { page: 1, per_page: per_page, total: 0, tasks: [] };
  }

  const entries = tasks
    // If projectId provided, filter tasks by project string match
    .filter((t) => !projectId || (t.project && t.project.includes(projectId)))
    .slice(0, per_page)
    .map((t) => {
      const changes = [];
      // iteration change
      if (t.iterationPath) {
        changes.push({
          field: 'iteration',
          value: t.iterationPath.replace('\\', '\\'),
          changed_at: randomPastDate(400),
          changed_by: HISTORY_USERS[Math.floor(Math.random() * HISTORY_USERS.length)],
        });
      }
      // start/end changes
      if (t.start) {
        changes.push({
          field: 'start',
          value: t.start,
          changed_at: randomPastDate(400),
          changed_by: HISTORY_USERS[Math.floor(Math.random() * HISTORY_USERS.length)],
          pair_id: Math.random() < 0.2 ? 1 : undefined,
        });
      }
      if (t.end) {
        changes.push({
          field: 'end',
          value: t.end,
          changed_at: randomPastDate(400),
          changed_by: HISTORY_USERS[Math.floor(Math.random() * HISTORY_USERS.length)],
          pair_id: Math.random() < 0.2 ? 1 : undefined,
        });
      }
      // ensure at least one change exists
      if (changes.length === 0) {
        changes.push({
          field: 'iteration',
          value: (t.iterationPath || 'Platform_Development').replace('\\', '\\'),
          changed_at: randomPastDate(400),
          changed_by: HISTORY_USERS[Math.floor(Math.random() * HISTORY_USERS.length)],
        });
      }

      return {
        task_id: t.id,
        title: t.title || `Task ${t.id}`,
        plan_id: t.plan_id || '',
        history: changes,
      };
    });

  return { page: 1, per_page: per_page, total: entries.length, tasks: entries };
}

// Cost data fixtures
const costData = {
  projects: [
    {
      project_id: 'project-a',
      project_name: 'Proj A',
      total_cost: 150000,
      total_capacity: 500,
      months: [
        { month: '2026-01', cost: 50000, capacity: 200 },
        { month: '2026-02', cost: 60000, capacity: 180 },
        { month: '2026-03', cost: 40000, capacity: 120 },
      ],
    },
    {
      project_id: 'project-b',
      project_name: 'Proj B',
      total_cost: 80000,
      total_capacity: 300,
      months: [
        { month: '2026-01', cost: 30000, capacity: 100 },
        { month: '2026-02', cost: 50000, capacity: 200 },
      ],
    },
  ],
  months: ['2026-01', '2026-02', '2026-03'],
  teams: [
    { team_id: 'team-t1', team_name: 'Team 1', total_cost: 100000 },
    { team_id: 'team-t2', team_name: 'Team 2', total_cost: 80000 },
    { team_id: 'team-t3', team_name: 'Team 3', total_cost: 50000 },
  ],
};

/*
const tasks = [
    { "startDate":         null, "finishDate":         null, "relations": [{ "type": "Child", "id": "764130", "url": "https://example.com/764130" }, { "type": "Related", "id": "753122", "url": "https://example.com/753122" }, { "type": "Child", "id": "764131", "url": "https://example.com/764131" }, { "type": "Child", "id": "764134", "url": "https://example.com/764134" }, { "type": "Child", "id": "764129", "url": "https://example.com/764129" }, { "type": "Parent", "id": "516154", "url": "https://example.com/516154" }], "url": "https://example.com/764122", "project": "project-architecture", "start": null, "end": null, "capacity": [] },
    { "startDate":         null, "finishDate":         null, "relations": [{ "type": "Child", "id": "652337", "url": "https://example.com/652337" }, { "type": "Parent", "id": "751031", "url": "https://example.com/751031" }], "url": "https://example.com/751412", "project": "project-architecture", "_inferred_start": true, "_inferred_end": true, "start": "2026-02-23", "end": "2026-03-20", "capacity": [] },
    { "startDate":         null, "finishDate":         null, "relations": [{ "type": "Child", "id": "666964", "url": "https://example.com/666964" }, { "type": "Parent", "id": "751031", "url": "https://example.com/751031" }], "url": "https://example.com/761893", "project": "project-architecture", "_inferred_start": true, "_inferred_end": true, "start": "2026-02-23", "end": "2026-03-20", "capacity": [] }, 
    { "startDate":         null, "finishDate":         null, "relations": [{ "type": "Child", "id": "753125", "url": "https://example.com/753125" }, { "type": "Child", "id": "755486", "url": "https://example.com/755486" }, { "type": "Child", "id": "753130", "url": "https://example.com/753130" }, { "type": "Child", "id": "753122", "url": "https://example.com/753122" }, { "type": "Child", "id": "753713", "url": "https://example.com/753713" }, { "type": "Child", "id": "754400", "url": "https://example.com/754400" }, { "type": "Child", "id": "754373", "url": "https://example.com/754373" }, { "type": "Parent", "id": "516154", "url": "https://example.com/516154" }], "url": "https://example.com/753121", "project": "project-architecture", "start": null, "end": null, "capacity": [] },
    { "startDate":         null, "finishDate":         null, "relations": [{ "type": "Parent", "id": "751031", "url": "https://example.com/751031" }, { "type": "Child", "id": "534770", "url": "https://example.com/534770" }], "url": "https://example.com/751414", "project": "project-architecture", "start": null, "end": null, "capacity": [] }, 
    { "startDate":         null, "finishDate":         null, "relations": [{ "type": "Parent", "id": "751031", "url": "https://example.com/751031" }, { "type": "Child", "id": "673064", "url": "https://example.com/673064" }], "url": "https://example.com/751411", "project": "project-architecture", "_inferred_start": true, "_inferred_end": true, "start": "2026-02-23", "end": "2026-03-20", "capacity": [] }, 
    { "startDate": "2025-08-09", "finishDate": "2025-09-08", "relations": [{ "type": "Child", "id": "516489", "url": "https://example.com/516489" }, { "type": "Child", "id": "520437", "url": "https://example.com/520437" }, { "type": "Child", "id": "520413", "url": "https://example.com/520413" }, { "type": "Parent", "id": "516154", "url": "https://example.com/516154" }, { "type": "Child", "id": "520319", "url": "https://example.com/520319" }, { "type": "Child", "id": "516490", "url": "https://example.com/516490" }, { "type": "Child", "id": "534821", "url": "https://example.com/534821" }], "url": "https://example.com/516412", "project": "project-architecture", "start": "2025-08-09", "end": "2025-09-08", "capacity": [] },
    { "startDate": "2025-09-06", "finishDate": "2025-10-06", "relations": [{ "type": "Child", "id": "516466", "url": "https://example.com/516466" }, { "type": "Child", "id": "521579", "url": "https://example.com/521579" }, { "type": "Child", "id": "516463", "url": "https://example.com/516463" }, { "type": "Child", "id": "525887", "url": "https://example.com/525887" }, { "type": "Child", "id": "551830", "url": "https://example.com/551830" }, { "type": "Child", "id": "516462", "url": "https://example.com/516462" }, { "type": "Child", "id": "534204", "url": "https://example.com/534204" }, { "type": "Child", "id": "552663", "url": "https://example.com/552663" }, { "type": "Child", "id": "516460", "url": "https://example.com/516460" }, { "type": "Child", "id": "516465", "url": "https://example.com/516465" }, { "type": "Child", "id": "516457", "url": "https://example.com/516457" }, { "type": "Child", "id": "696782", "url": "https://example.com/696782" }, { "type": "Parent", "id": "516154", "url": "https://example.com/516154" }], "url": "https://example.com/516364", "project": "project-architecture", "start": "2025-09-06", "end": "2025-10-06", "capacity": [] },
    { "startDate": "2025-08-06", "finishDate": "2025-09-05", "relations": [{ "type": "Child", "id": "516426", "url": "https://example.com/516426" }, { "type": "Child", "id": "520112", "url": "https://example.com/520112" }, { "type": "Child", "id": "528222", "url": "https://example.com/528222" }, { "type": "Child", "id": "516422", "url": "https://example.com/516422" }, { "type": "Child", "id": "644183", "url": "https://example.com/644183" }, { "type": "Child", "id": "519796", "url": "https://example.com/519796" }, { "type": "Child", "id": "526025", "url": "https://example.com/526025" }, { "type": "Child", "id": "528459", "url": "https://example.com/528459" }, { "type": "Child", "id": "516431", "url": "https://example.com/516431" }, { "type": "Child", "id": "516479", "url": "https://example.com/516479" }, { "type": "Child", "id": "516472", "url": "https://example.com/516472" }, { "type": "Child", "id": "551435", "url": "https://example.com/551435" }, { "type": "Child", "id": "525924", "url": "https://example.com/525924" }, { "type": "Child", "id": "528465", "url": "https://example.com/528465" }, { "type": "Child", "id": "541736", "url": "https://example.com/541736" }, { "type": "Parent", "id": "516154", "url": "https://example.com/516154" }, { "type": "Child", "id": "521818", "url": "https://example.com/521818" }], "url": "https://example.com/516413", "project": "project-architecture", "start": "2025-08-06", "end": "2025-09-05", "capacity": [] }, 
    { "startDate": "2025-07-04", "finishDate": "2025-11-13", "relations": [{ "type": "Child", "id": "654571", "url": "https://example.com/654571" }, { "type": "Child", "id": "516413", "url": "https://example.com/516413" }, { "type": "Child", "id": "516412", "url": "https://example.com/516412" }, { "type": "Child", "id": "764122", "url": "https://example.com/764122" }, { "type": "Child", "id": "753121", "url": "https://example.com/753121" }, { "type": "Child", "id": "747461", "url": "https://example.com/747461" }, { "type": "Child", "id": "516364", "url": "https://example.com/516364" }, { "type": "Child", "id": "535825", "url": "https://example.com/535825" }, { "type": "Child", "id": "534751", "url": "https://example.com/534751" }, { "type": "Child", "id": "516419", "url": "https://example.com/516419" }], "url": "https://example.com/516154", "project": "project-architecture", "start": "2025-07-04", "end": "2025-11-13", "capacity": [] }, 
    { "startDate":         null, "finishDate":         null, "relations": [{ "type": "Child", "id": "713820", "url": "https://example.com/713820" }], "url": "https://example.com/701089", "project": "project-architecture", "start": null, "end": null, "capacity": [{ "team": "team-architecture", "capacity": 100 }] },
    { "startDate": "2026-01-26", "finishDate": "2026-05-26", "relations": [{ "type": "Child", "id": "688050", "url": "https://example.com/688050" }, { "type": "Child", "id": "688049", "url": "https://example.com/688049" }, { "type": "Child", "id": "688048", "url": "https://example.com/688048" }, { "type": "Child", "id": "688051", "url": "https://example.com/688051" }], "url": "https://example.com/682664", "project": "project-architecture", "start": "2026-01-26", "end": "2026-05-26", "capacity": [{ "team": "team-architecture", "capacity": 100 }] },
    { "startDate":         null, "finishDate":         null, "relations": [{ "type": "Parent", "id": "713821", "url": "https://example.com/713821" }], "url": "https://example.com/713812", "project": "project-architecture", "start": null, "end": null, "capacity": [] }, 
    { "startDate":         null, "finishDate":         null, "relations": [{ "type": "Child", "id": "751412", "url": "https://example.com/751412" }, { "type": "Child", "id": "751411", "url": "https://example.com/751411" }, { "type": "Child", "id": "751415", "url": "https://example.com/751415" }, { "type": "Child", "id": "751033", "url": "https://example.com/751033" }, { "type": "Child", "id": "761893", "url": "https://example.com/761893" }, { "type": "Child", "id": "751396", "url": "https://example.com/751396" }, { "type": "Child", "id": "751414", "url": "https://example.com/751414" }], "url": "https://example.com/751031", "project": "project-architecture", "_inferred_start": true, "_inferred_end": true, "start": "2026-02-23", "end": "2026-03-20", "capacity": [] }, 
    { "startDate": "2025-08-22", "finishDate": "2025-09-21", "relations": [{ "type": "Child", "id": "528073", "url": "https://example.com/528073" }, { "type": "Child", "id": "635450", "url": "https://example.com/635450" }, { "type": "Child", "id": "573704", "url": "https://example.com/573704" }, { "type": "Parent", "id": "516154", "url": "https://example.com/516154" }, { "type": "Child", "id": "533754", "url": "https://example.com/533754" }, { "type": "Child", "id": "596806", "url": "https://example.com/596806" }, { "type": "Child", "id": "598455", "url": "https://example.com/598455" }, { "type": "Child", "id": "516421", "url": "https://example.com/516421" }, { "type": "Child", "id": "533720", "url": "https://example.com/533720" }, { "type": "Child", "id": "527329", "url": "https://example.com/527329" }, { "type": "Child", "id": "574185", "url": "https://example.com/574185" }], "url": "https://example.com/516419", "project": "project-architecture", "start": "2025-08-22", "end": "2025-09-21", "capacity": [] }]
*/
export const handlers = [
  // General scheme:
  //  http.get('/resource', ({ request, params, cookies }) => { return HttpResponse.json(data) }),

  // Health
  http.get('/api/health', () => {
    return HttpResponse.json(health);
  }),

  // Session creation
  http.post('/api/session', (req) => {
    return HttpResponse.json(session);
  }),

  // Features list and single item
  http.get('/api/tasks', () => {
    return HttpResponse.json(tasks, { status: 200 });
  }),
  http.get(new RegExp('/api/tasks/.*'), ({ request }) => {
    const id = new URL(request.url).pathname.split('/').pop();
    const f = tasks.find((x) => x.id === id) || null;
    return HttpResponse.json(f, { status: 200 });
  }),
  // Accept task updates or publishing baseline via POST /api/tasks
  http.post('/api/tasks', async ({ request }) => {
    const body = await request.json();
    // Normalize incoming payload: may be array of updates or an object
    const updates =
      Array.isArray(body) ? body
      : body && body.updates ? body.updates
      : body;
    const updated = [];
    if (Array.isArray(updates)) {
      updates.forEach((u) => {
        if (!u || !u.id) return;
        const t = tasks.find((x) => x.id === String(u.id));
        if (t) {
          // merge simple fields
          if (u.start !== undefined) t.start = u.start;
          if (u.end !== undefined) t.end = u.end;
          if (u.iterationPath !== undefined) t.iterationPath = u.iterationPath;
          if (u.capacity !== undefined) t.capacity = u.capacity;
          updated.push(t.id);
        }
      });
    }
    return HttpResponse.json({ ok: true, updated }, { status: 200 });
  }),

  // Update capacity for a specific work item
  http.put(new RegExp('/api/tasks/.*/capacity'), async ({ request }) => {
    const url = new URL(request.url);
    const parts = url.pathname.split('/');
    const id = parts[parts.length - 2];
    const body = await request.json();
    const t = tasks.find((x) => x.id === id);
    if (!t) return HttpResponse.json({ ok: false, error: 'not-found' }, { status: 404 });
    // body is expected to be an array of {team, capacity}
    t.capacity = Array.isArray(body) ? body : [];
    return HttpResponse.json(
      { ok: true, id: t.id, capacity: t.capacity },
      { status: 200 }
    );
  }),

  // Projects
  http.get('/api/projects', () => {
    return HttpResponse.json(projects, { status: 200 });
  }),

  // Teams
  http.get('/api/teams', () => {
    return HttpResponse.json(teams, { status: 200 });
  }),

  // Iterations
  http.get('/api/iterations', () => {
    return HttpResponse.json(iterations, { status: 200 });
  }),

  // Markers
  http.get('/api/markers', () => {
    return HttpResponse.json(markers, { status: 200 });
  }),

  // Account config save
  http.post('/api/account', async ({ request }) => {
    const body = await request.json();
    // echo back saved config
    return HttpResponse.json(body || {}, { status: 200 });
  }),

  // History - return generated history for tasks
  http.get(new RegExp('/api/history/tasks.*'), ({ request }) => {
    const url = new URL(request.url);
    const per_page = parseInt(url.searchParams.get('per_page') || '500', 10);
    const project = url.searchParams.get('project') || null;
    const invalidate = url.searchParams.get('invalidate_cache');
    // allow tests to request empty history by setting invalidate_cache=true&empty_history=true
    const result = generateHistory(project, per_page);
    return HttpResponse.json(result, { status: 200 });
  }),

  // Scenarios - single handler: if ?id= present return detail, otherwise return list
  http.get('/api/scenario', ({ request }) => {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (id) {
      const full = scenarioOverrides[id] ||
        scenarios.find((x) => x.id === id) || { status: false, error: 'not-found' };
      return HttpResponse.json(full, { status: 200 });
    }
    return HttpResponse.json(scenarios, { status: 200 });
  }),

  // Scenario create/update/delete (mirror view handlers)
  http.post('/api/scenario', async ({ request }) => {
    const body = await request.json();
    // delete operation
    if (body && body.op === 'delete') {
      const id = body.data && body.data.id;
      const idx = scenarios.findIndex((x) => x.id === id);
      if (idx >= 0) scenarios.splice(idx, 1);
      if (id && scenarioOverrides[id]) delete scenarioOverrides[id];
      return HttpResponse.json({ ok: true }, { status: 200 });
    }

    // save operation
    const data = (body && body.data) || {};
    // generate id for new scenarios
    if (!data.id) {
      data.id = Math.random().toString(36).slice(2, 12);
      const response = { id: data.id, user: 'bob@example.com', shared: false };
      scenarios.push(response);
      // store full scenario details
      scenarioOverrides[data.id] = data;
      return HttpResponse.json(response, { status: 200 });
    } else {
      // update name in list if present
      const existing = scenarios.find((x) => x.id === data.id);
      if (existing) existing.name = data.name || existing.name;
      // replace stored full details
      scenarioOverrides[data.id] = data;
      return HttpResponse.json(data, { status: 200 });
    }
  }),

  // Views - single handler: if ?id= present return detail, otherwise return list
  http.get('/api/view', ({ request }) => {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (id) {
      console.log('MSW /api/view returning view id=', id);
      const v = viewDetails[id] || { status: false, error: 'not-found' };
      return HttpResponse.json(v, { status: 200 });
    }
    console.log('MSW /api/view returning list of views');
    return HttpResponse.json(views, { status: 200 });
  }),

  http.post('/api/view', async ({ request }) => {
    const body = await request.json();
    // delete operation
    if (body && body.op === 'delete') {
      const id = body.data && body.data.id;
      // remove from list if present
      const idx = views.findIndex((x) => x.id === id);
      if (idx >= 0) views.splice(idx, 1);
      if (id && viewDetails[id]) delete viewDetails[id];
      return HttpResponse.json({ ok: true }, { status: 200 });
    }
    // save operation
    const data = (body && body.data) || {};
    // generate id for new views
    if (!data.id) {
      data.id = Math.random().toString(36).slice(2, 10);
      const response = { id: data.id, user: 'bob@example.com', name: data.name };
      views.push(response);
      viewDetails[data.id] = data;
      return HttpResponse.json(response, { status: 200 });
    } else {
      // update name in list if present
      const existing = views.find((x) => x.id === data.id);
      if (existing) existing.name = data.name || existing.name;
      viewDetails[data.id] = data;
      return HttpResponse.json(existing, { status: 200 });
    }
  }),

  // Cost endpoints
  http.get('/api/cost', ({ request }) => {
    return HttpResponse.json(costData, { status: 200 });
  }),

  http.post('/api/cost', async ({ request }) => {
    const body = await request.json();
    // Return cost data (possibly computed from overrides or features payload)
    return HttpResponse.json(costData, { status: 200 });
  }),

  http.post('/api/cost/features', async ({ request }) => {
    const body = await request.json();
    // Return cost data computed from features
    return HttpResponse.json(costData, { status: 200 });
  }),

  http.get('/api/cost/teams', () => {
    return HttpResponse.json(costTeams, { status: 200 });
  }),

  // Cache invalidation
  http.post('/api/cache/invalidate', async ({ request }) => {
    return HttpResponse.json({ ok: true, invalidated: true }, { status: 200 });
  }),

  // Generic fallback for other endpoints to avoid silent empty objects
  http.all('*', () => {
    // let tests override as needed; by default return 404 to surface missing handlers
    return HttpResponse.json({ error: 'no-mock-handler' }, { status: 404 });
  }),
];

export default handlers;
