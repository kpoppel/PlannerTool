import { cmd, sel } from '../application/imports.js';

const TIMELINE_SCALES = ['threeMonths', 'weeks', 'months', 'quarters', 'years'];
const DISPLAY_MODES = ['normal', 'compact', 'packed'];
const SORT_MODES = ['rank', 'date'];
const GRAPH_MODES = ['team', 'project'];

export class KeyboardShortcutManager {
  constructor(target, definitions) {
    this.target = target;
    this.definitions = definitions;
    this.handleKeydown = this.handleKeydown.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
  }

  connect() {
    this.target.addEventListener('keydown', this.handleKeydown);
    this.target.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  disconnect() {
    this.target.removeEventListener('keydown', this.handleKeydown);
    this.target.removeEventListener('wheel', this.handleWheel);
  }

  handleKeydown(event) {
    const definition = this.definitions.find((candidate) =>
      matchesKeydown(candidate, event)
    );
    if (!definition) return;
    event.preventDefault();
    definition.run(event);
  }

  handleWheel(event) {
    if (!event.ctrlKey || event.deltaY === 0) return;
    const definition = this.definitions.find((candidate) => candidate.wheel === true);
    if (!definition) return;
    event.preventDefault();
    definition.run(event);
  }
}

export function createApplicationShortcutDefinitions(dependencies) {
  const { commands, selectors, openSearch, getTimelineBoard } = dependencies;
  const adjustBoardZoom = (direction, anchorClientY) => {
    const board = getTimelineBoard();
    // Lifecycle guard: element may be absent or not upgraded yet at this phase of render/interaction.
    if (!board) return;
    board.adjustBoardZoom(direction, anchorClientY);
  };
  const resetBoardZoom = () => {
    const board = getTimelineBoard();
    // Lifecycle guard: element may be absent or not upgraded yet at this phase of render/interaction.
    if (!board) return;
    board.resetBoardZoom();
  };

  return [
    shortcut('search', 'f', () => openSearch()),
    shortcut('timeline-scale', 't', () => {
      commands.setTimelineScale(nextOption(TIMELINE_SCALES, selectors.getTimelineScale()));
    }),
    shortcut('card-display', 'c', () => {
      commands.setDisplayMode(nextOption(DISPLAY_MODES, selectors.getDisplayMode()));
    }),
    shortcut('task-sort', 's', () => {
      commands.setFeatureSortMode(nextOption(SORT_MODES, selectors.getFeatureSortMode()));
    }),
    shortcut('graph-type', 'g', () => {
      commands.setCapacityViewMode(nextOption(GRAPH_MODES, selectors.getCapacityViewMode()));
    }),
    { id: 'board-zoom-in', keys: ['+', '='], ctrlKey: true, run: () => adjustBoardZoom(1) },
    { id: 'board-zoom-out', keys: ['-'], ctrlKey: true, run: () => adjustBoardZoom(-1) },
    { id: 'board-zoom-reset', keys: ['0'], ctrlKey: true, run: resetBoardZoom },
    {
      id: 'board-zoom-wheel',
      wheel: true,
      run: (event) =>
        adjustBoardZoom(event.deltaY < 0 ? 1 : -1, event.clientY),
    },
  ];
}

export function initKeyboardShortcuts() {
  const definitions = createApplicationShortcutDefinitions({
    commands: cmd.view,
    selectors: sel.view,
    openSearch,
    getTimelineBoard: () => document.querySelector('timeline-board'),
  });
  const manager = new KeyboardShortcutManager(document, definitions);
  manager.connect();
  return manager;
}

function shortcut(id, key, run) {
  return { id, keys: [key], ctrlKey: true, shiftKey: true, run };
}

function matchesKeydown(definition, event) {
  if (!definition.keys) return false;
  if (definition.ctrlKey !== event.ctrlKey) return false;
  if ('shiftKey' in definition && definition.shiftKey !== event.shiftKey) return false;
  return definition.keys.includes(event.key.toLowerCase());
}

function nextOption(options, current) {
  const currentIndex = options.indexOf(current);
  if (currentIndex === -1) {
    throw new Error(`Unknown display option: ${current}`);
  }
  return options[(currentIndex + 1) % options.length];
}

async function openSearch() {
  await import('../components/SearchTool.lit.js');
  let searchTool = document.querySelector('search-tool');
  if (!searchTool) {
    searchTool = document.createElement('search-tool');
    document.body.appendChild(searchTool);
  }
  setTimeout(() => searchTool.open(), 0);
}