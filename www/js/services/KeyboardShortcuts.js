import { cmd, sel } from '../application/imports.js';
import { bus } from '../core/EventBus.js';
import { BoardEvents, ConfigEvents } from '../core/EventRegistry.js';
import { dataService } from './dataService.js';

const TIMELINE_SCALES = ['threeMonths', 'weeks', 'months', 'quarters', 'years'];
const DISPLAY_MODES = ['normal', 'compact', 'packed'];
const SORT_MODES = ['rank', 'date'];
const SHORTCUT_OWNING_CONTROLS = [
  'input', 'textarea', 'select',
  'top-menu-bar', 'group-context-menu',
  '[role="textbox"]', '[role="searchbox"]', '[role="combobox"]',
  '[role="spinbutton"]', '[role="slider"]', '[role="menu"]',
  '[role="menubar"]', '[role="listbox"]', '[role="dialog"]', '[role="alertdialog"]',
].join(', ');

export class KeyboardShortcutManager {
  constructor(target, definitions) {
    this.target = target;
    this.definitions = definitions;
    this.characterShortcutsEnabled = true;
    this.handleConfigUpdated = ({ characterShortcutsEnabled }) => {
      this.characterShortcutsEnabled = characterShortcutsEnabled;
    };
    this.handleKeydown = this.handleKeydown.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
  }

  connect() {
    bus.on(ConfigEvents.UPDATED, this.handleConfigUpdated);
    this.target.addEventListener('keydown', this.handleKeydown);
    this.target.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  disconnect() {
    bus.off(ConfigEvents.UPDATED, this.handleConfigUpdated);
    this.target.removeEventListener('keydown', this.handleKeydown);
    this.target.removeEventListener('wheel', this.handleWheel);
  }

  handleKeydown(event) {
    if (event.defaultPrevented || event.isComposing) return;
    if (document.body.classList.contains('has-modal') || ownsKeyboardInput(event)) return;
    const characterKey = event.key.length === 1 &&
      !event.ctrlKey && !event.altKey && !event.metaKey;
    if (characterKey && (!this.characterShortcutsEnabled || event.repeat)) return;
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
  const { commands, selectors, filterCommands, openSearch, getTimelineBoard, foldHierarchy } = dependencies;
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
      if (selectors.getPackedMode()) return;
      commands.setFeatureSortMode(nextOption(SORT_MODES, selectors.getFeatureSortMode()));
    }),
    shortcut('graph-type', 'g', () => {
      const types = selectors.getAvailableGraphTypes();
      if (types.length === 0) return;
      commands.setCapacityViewMode(nextOption(types, selectors.getEffectiveCapacityViewMode()));
    }),
    shortcut('task-view', 'v', () => {
      commands.setTaskViewMode(nextOption(['plan', 'team'], selectors.getTaskViewMode()));
    }),
    shortcut('highlight-relations', 'h', () => {
      commands.setHighlightFeatureRelationMode(!selectors.getHighlightFeatureRelationMode());
    }),
    shortcut('filter-schedule', 'p', () => filterCommands.cycleTaskFilter('schedule')),
    shortcut('filter-allocation', 'a', () => filterCommands.cycleTaskFilter('allocation')),
    shortcut('filter-hierarchy', 'i', () => filterCommands.cycleTaskFilter('hierarchy')),
    shortcut('filter-relations', 'r', () => filterCommands.cycleTaskFilter('relations')),
    {
      id: 'hierarchy-expand', keys: ['+'], allowShift: true,
      run: () => foldHierarchy('expand-one'),
    },
    shortcut('hierarchy-collapse', '-', () => foldHierarchy('collapse-one')),
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

export async function initKeyboardShortcuts() {
  const definitions = createApplicationShortcutDefinitions({
    commands: cmd.view,
    selectors: sel.view,
    filterCommands: cmd.filter,
    openSearch,
    getTimelineBoard: () => document.querySelector('timeline-board'),
    foldHierarchy: (action) => bus.emit(BoardEvents.FOLD_ACTION, { action }),
  });
  const manager = new KeyboardShortcutManager(document, definitions);
  manager.characterShortcutsEnabled = await dataService.getLocalPref('keyboard.letters') !== false;
  manager.connect();
  return manager;
}

function shortcut(id, key, run) {
  return { id, keys: [key], run };
}

function matchesKeydown(definition, event) {
  if (!definition.keys) return false;
  for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) {
    if ((definition[modifier] === true) !== event[modifier]) return false;
  }
  const commandModifier = event.ctrlKey || event.altKey || event.metaKey;
  if ('shiftKey' in definition || (!commandModifier && definition.allowShift !== true)) {
    if ((definition.shiftKey === true) !== event.shiftKey) return false;
  }
  return definition.keys.some((key) =>
    key === event.key.toLowerCase() || event.code === `Digit${key}`
  );
}

function ownsKeyboardInput(event) {
  // Shadow DOM retargets event.target to the host; the path retains the actual control.
  return event.composedPath().some((node) => node instanceof HTMLElement && (
    node.matches(SHORTCUT_OWNING_CONTROLS) || node.isContentEditable ||
    (node.hasAttribute('contenteditable') && node.getAttribute('contenteditable') !== 'false')
  ));
}

function nextOption(options, current) {
  const currentIndex = options.indexOf(current);
  if (currentIndex === -1) {
    throw new Error(`Unknown display option: ${current}`);
  }
  return options[(currentIndex + 1) % options.length];
}

async function openSearch() {
  const { SearchTool } = await import('../components/SearchTool.lit.js');
  let searchTool = /** @type {import('../components/SearchTool.lit.js').SearchTool} */ (
    document.querySelector('search-tool')
  );
  if (!searchTool) {
    searchTool = new SearchTool();
    document.body.appendChild(searchTool);
  }
  setTimeout(() => searchTool.open(), 0);
}