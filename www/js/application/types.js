/**
 * @typedef {{
 *   id: string|number,
 *   name?: string,
 *   readonly?: boolean,
 *   overrides?: Record<string, any>,
 *   filters?: Record<string, any>,
 *   view?: Record<string, any>,
 *   groupOverrides?: Record<string, any>,
 *   scenarioGroups?: any[]
 * }} ScenarioItem
 */

/**
 * @typedef {{
 *   status: string,
 *   error: any
 * }} LifecycleState
 */

/**
 * @typedef {{
 *   revision: number|null,
 *   projects: any[],
 *   teams: any[],
 *   features: any[],
 *   iterationsByProject: Record<string, any>
 * }} BaselineState
 */

/**
 * @typedef {{
 *   activeId: string,
 *   changedIds: string[],
 *   items: ScenarioItem[]
 * }} ScenariosState
 */

/**
 * @typedef {{
 *   projectIds: Array<string|number>,
 *   teamIds: Array<string|number>,
 *   featureStateNames: string[],
 *   taskFilters: Record<string, Record<string, boolean>>,
 *   taskTypeNames: string[],
 *   sidebarDisabled: Record<string, boolean>
 * }} SelectionState
 */

/**
 * @typedef {{
 *   parent: boolean,
 *   child: boolean,
 *   dependency: boolean,
 *   otherAllocations: boolean
 * }} ViewContextState
 */

/**
 * @typedef {{
 *   debugFlag: boolean,
 *   highlightFeatureRelationMode: boolean,
 *   [key: string]: any
 * }} ViewOptionsState
 */

/**
 * @typedef {{
 *   activeId: string|null,
 *   saved: any[],
 *   options: ViewOptionsState,
 *   context: ViewContextState
 * }} ViewState
 */

/**
 * @typedef {{
 *   byPlanId: Record<string, any[]>
 * }} GroupsState
 */

/**
 * @typedef {{
 *   dates: any[],
 *   teamDaily: any[],
 *   teamDailyMap: any[],
 *   projectDailyRaw: any[],
 *   projectDaily: any[],
 *   projectDailyMap: any[],
 *   organizationDaily: any[],
 *   organizationDailyPerTeamAverage: any[]
 * }} CapacityState
 */

/**
 * @typedef {{
 *   selectedId: string|null
 * }} FeatureDisplayState
 */

/**
 * @typedef {{
 *   lifecycle: LifecycleState,
 *   baseline: BaselineState,
 *   scenarios: ScenariosState,
 *   selection: SelectionState,
 *   view: ViewState,
 *   groups: GroupsState,
 *   pluginState: Record<string, any>,
 *   capacity: CapacityState,
 *   featureDisplay: FeatureDisplayState
 * }} AppState
 */

/**
 * @callback SetStateFn
 * @param {((state: AppState) => AppState)|AppState} updater
 * @param {...any} args
 * @returns {void}
 */

/**
 * @typedef {{
 *   getState: () => AppState,
 *   setState: SetStateFn,
 *   subscribe?: Function
 * }} StoreApi
 */

/**
 * @typedef {{
 *   emit: (event: any, payload?: any) => void,
 *   on?: (event: any, handler: Function) => void,
 *   off?: (event: any, handler: Function) => void
 * }} EventBusLike
 */

/**
 * @typedef {{
 *   suppressEvents?: boolean,
 *   [key: string]: any
 * }} CommandOptions
 */

export {};
