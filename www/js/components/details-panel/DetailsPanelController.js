import { bus } from '../../core/EventBus.js';
import { StoreController } from '../../core/StoreController.js';
import { UIEvents, FeatureEvents, ProjectEvents, TeamEvents } from '../../core/EventRegistry.js';
import { sel } from '../../application/imports.js';
import { buildDetailsPanelCapacityModel, cancelCapacityWheelEdits } from './DetailsPanelCapacity.lit.js';
import { buildDetailsPanelRelationsModel } from './DetailsPanelRelations.lit.js';
import {
	buildDetailsPanelSchedulingModel, getDetailsPanelChildDateBounds,
} from './DetailsPanelScheduling.lit.js';
import { buildDetailsPanelTagsModel } from './DetailsPanelTags.lit.js';

/** Lifecycle and drafts belong to the currently displayed feature and scenario. */
export class DetailsPanelController {
	constructor(host) {
		this.host = host;
		this.editor = {
			editingState: false, stateEditValue: null, newTagText: '',
			editingCapacityTeam: null, showAddTeamPopover: false,
		};
		this._subscriptions = [];
		this._timers = new Set();
		this._generation = 0;
		this._iterationRequest = 0;
		this._featureId = null;
		this._open = false;
		this._scenarioSnapshot = undefined;
		this._boardMouseDown = null;
		this._onMouseDown = (event) => {
			const hit = event.composedPath().some((node) =>
				node instanceof Element && (node.localName === 'feature-board' || node.id === 'board-area'));
			this._boardMouseDown = hit ? { x: event.clientX, y: event.clientY } : null;
		};
		this._onClick = (event) => {
			const down = this._boardMouseDown;
			this._boardMouseDown = null;
			if (host.open && down && down.x === event.clientX && down.y === event.clientY) host.hide();
		};
		this._scenarios = new StoreController(host, (state) => state.scenarios);
		this._allocation = new StoreController(host, (state) => state.allocation);
		this._allocationSnapshot = this._allocation.value;
		host.addController(this);
	}

	hostConnected() {
		this._scenarioSnapshot = this._scenarios.value;
		this._allocationSnapshot = this._allocation.value;
		this._subscriptions = [
			bus.on(UIEvents.DETAILS_SHOW, () => this.show()),
			bus.on(FeatureEvents.SELECTED, () => this.show()),
			bus.on(FeatureEvents.UPDATED, (payload) => this.refresh(payload)),
			bus.on(ProjectEvents.CHANGED, () => {
				if (this.host.open && this.host.feature) this.host._loadSchedulePresetsForFeature();
			}),
			bus.on(TeamEvents.CHANGED, () => this.refresh()),
		];
		document.body.addEventListener('mousedown', this._onMouseDown);
		document.body.addEventListener('click', this._onClick);
	}

	hostUpdate() {
		const featureId = this.host.feature === null ? null : String(this.host.feature.id);
		if ((this._featureId !== null && featureId !== this._featureId) ||
			(this._open && !this.host.open)) this.resetEditors();
		this._featureId = featureId;
		this._open = this.host.open;
		if (this._allocationSnapshot !== this._allocation.value) {
			this._allocationSnapshot = this._allocation.value;
			this.resetEditors();
		}
		if (this._scenarioSnapshot !== this._scenarios.value) {
			this._scenarioSnapshot = this._scenarios.value;
			this.resetEditors();
			this.refresh();
		}
	}

	hostDisconnected() {
		for (const unsubscribe of this._subscriptions) unsubscribe();
		this._subscriptions = [];
		document.body.removeEventListener('mousedown', this._onMouseDown);
		document.body.removeEventListener('click', this._onClick);
		this.resetEditors();
		this._boardMouseDown = null;
	}

	show() {
		const feature = sel.feature.getSelectedFeature();
		if (!feature) return;
		this.resetEditors();
		this.host.feature = feature;
		this.host.open = true;
		this.host.requestUpdate();
	}

	refresh(payload) {
		const host = this.host;
		if (!host.open || !host.feature) return;
		if (payload !== undefined && payload !== null && Object.hasOwn(payload, 'ids') &&
			!payload.ids.some((id) => String(id) === String(host.feature.id))) return;
		const feature = sel.feature.getEffectiveFeatureById(host.feature.id);
		if (!feature) return;
		host.feature = feature;
		host._loadSchedulePresetsForFeature();
		host.requestUpdate();
	}

	resetEditors() {
		this._generation += 1;
		// Lifecycle guard: element may be absent or not upgraded yet at this phase of render/interaction.
		if (this.host.shadowRoot !== null) cancelCapacityWheelEdits(this.host.shadowRoot);
		for (const timer of this._timers) clearTimeout(timer);
		this._timers.clear();
		this.editor.editingState = false;
		this.editor.stateEditValue = null;
		this.editor.newTagText = '';
		this.editor.editingCapacityTeam = null;
		this.editor.showAddTeamPopover = false;
	}

	capture() {
		return {
			generation: this._generation,
			featureId: this.host.feature === null ? null : String(this.host.feature.id),
			scenarios: this._scenarios.value,
			allocation: this._allocation.value,
			feature: this.host.feature,
		};
	}

	isCurrent(work) {
		return work.generation === this._generation && this.host.isConnected && this.host.open &&
			this.host.feature !== null && String(this.host.feature.id) === work.featureId &&
			this._scenarios.value === work.scenarios && this.host.feature === work.feature &&
			this._allocation.value === work.allocation;
	}

	defer(callback, delay) {
		const work = this.capture();
		const timer = setTimeout(() => {
			this._timers.delete(timer);
			if (this.isCurrent(work)) callback();
		}, delay);
		this._timers.add(timer);
	}

	bindActions(actions) {
		const work = this.capture();
		return Object.fromEntries(Object.entries(actions).map(([name, action]) => [
			name, (...args) => {
				if (this.isCurrent(work)) return action(...args);
			},
		]));
	}

	bindMutationActions(actions) {
		return this.bindActions(Object.fromEntries(Object.entries(actions).map(([name, action]) => [
			name, (...args) => {
				if (!sel.scenario.isActiveScenarioMutable()) return false;
				return action(...args);
			},
		])));
	}

	getChildDateBounds() {
		const ids = sel.feature.getChildrenByParentMap().get(String(this.host.feature.id));
		const children = ids === undefined ? [] : ids.map((id) => sel.feature.getEffectiveFeatureById(id));
		return getDetailsPanelChildDateBounds(children);
	}

	getPresentationModel(today) {
		const feature = this.host.feature;
		const projects = sel.selection.getProjects();
		const teams = sel.selection.getTeams();
		const stateColors = sel.filter.getFeatureStateColors();
		const originalState = feature.original === undefined ? undefined : feature.original.state;
		const originalTags = feature.original === undefined ? undefined : feature.original.tags;
		const project = projects.find((item) => item.id === feature.project);
		const planName = project ? project.name
			: feature.ancestorOnly === true ? feature.sourcePlanName : null;
		const linkedFeatures = new Map();
		const stateCategories = new Map();
		for (const relation of feature.relations) {
			const id = String(relation.id);
			const linked = sel.feature.getBaselineFeatureById(id);
			if (linked) {
				linkedFeatures.set(id, linked);
								stateCategories.set(id, sel.filter.getFeatureStateCategory(linked));
			}
		}
		const model = {
			header: {
				feature, planName,
				stateChanged: originalState !== undefined && feature.state !== originalState,
				originalState, stateColors, availableFeatureStates: sel.filter.getFeatureStates(feature).map((state) => state.name),
				editingState: this.editor.editingState, stateEditValue: this.editor.stateEditValue,
			},
			scheduling: buildDetailsPanelSchedulingModel({
				feature, presets: this.host.schedulePresets,
				childrenByParent: sel.feature.getChildrenByParentMap(), orig: feature.original, today,
			}),
			capacity: buildDetailsPanelCapacityModel({
				allocation: this._allocation.value, feature,
				capacity: feature.capacity, orgLoad: feature.orgLoad, teams,
				availability: sel.feature.getAllocationAvailability(feature),
				showAddTeamPopover: this.editor.showAddTeamPopover,
			}),
			tags: buildDetailsPanelTagsModel({
				tagsValue: feature.tags, originalTags, newTagText: this.editor.newTagText,
			}),
			relations: buildDetailsPanelRelationsModel({
				relations: feature.relations, projectId: feature.project, featureUrl: feature.url,
				projects, linkedFeatures, stateColors, stateCategories,
			}),
		};
		const readonly = !sel.scenario.isActiveScenarioMutable();
		for (const section of ['header', 'scheduling', 'capacity', 'tags']) model[section].readonly = readonly;
		return model;
	}

	async loadSchedulePresets() {
		const host = this.host;
		const feature = host.feature;
		const work = this.capture();
		const request = ++this._iterationRequest;
		if (!feature) {
			host.schedulePresets = [];
			return;
		}
		const projectId = feature.project ? String(feature.project).trim() : '';
		host.schedulePresets = sel.feature.getSchedulePresetsForProject(projectId);
		await host.updateComplete;
		if (!this.isCurrent(work) || request !== this._iterationRequest) return;
		// Lifecycle guard: element may be absent or not upgraded yet at this phase of render/interaction.
		const select = host.shadowRoot.querySelector('.iteration-select');
		if (select) select.value = this.getPresentationModel(new Date().toISOString().slice(0, 10)).scheduling.selectedPresetId;
	}
}
