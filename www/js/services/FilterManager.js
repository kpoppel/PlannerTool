/**
 * FilterManager Service
 * Manages project and team filtering
 */

import { ProjectEvents, TeamEvents, FeatureEvents } from '../core/EventRegistry.js';

export class FilterManager {
  /**
   * @param {EventBus} eventBus
   * @param {Array} projects - Reference to projects array
   * @param {Array} teams - Reference to teams array
   */
  constructor(eventBus, projects, teams) {
    this.bus = eventBus;
    this.projects = projects;
    this.teams = teams;
  }
  
  // ===== Project Filtering =====
  
  toggleProject(projectId) {
    const project = this.projects.find(p => p.id === projectId);
    if (!project) {
      console.warn(`Project not found: ${projectId}`);
      return;
    }
    
    project.selected = !project.selected;
    this.bus.emit(ProjectEvents.CHANGED, this.projects);
    this.bus.emit(FeatureEvents.UPDATED);
  }
  
  selectAllProjects() {
    this.projects.forEach(p => p.selected = true);
    this.bus.emit(ProjectEvents.CHANGED, this.projects);
    this.bus.emit(FeatureEvents.UPDATED);
  }
  
  deselectAllProjects() {
    this.projects.forEach(p => p.selected = false);
    this.bus.emit(ProjectEvents.CHANGED, this.projects);
    this.bus.emit(FeatureEvents.UPDATED);
  }
  
  getSelectedProjects() {
    return this.projects
      .filter(p => p.selected)
      .map(p => p.id);
  }
  
  // ===== Team Filtering =====
  
  toggleTeam(teamId) {
    const team = this.teams.find(t => t.id === teamId);
    if (!team) {
      console.warn(`Team not found: ${teamId}`);
      return;
    }
    
    team.selected = !team.selected;
    this.bus.emit(TeamEvents.CHANGED, this.teams);
    this.bus.emit(FeatureEvents.UPDATED);
  }
  
  selectAllTeams() {
    this.teams.forEach(t => t.selected = true);
    this.bus.emit(TeamEvents.CHANGED, this.teams);
    this.bus.emit(FeatureEvents.UPDATED);
  }
  
  deselectAllTeams() {
    this.teams.forEach(t => t.selected = false);
    this.bus.emit(TeamEvents.CHANGED, this.teams);
    this.bus.emit(FeatureEvents.UPDATED);
  }
  
  getSelectedTeams() {
    return this.teams
      .filter(t => t.selected)
      .map(t => t.id);
  }
  
  // ===== Filter Capture and Apply =====
  
  captureFilters() {
    return {
      projects: this.getSelectedProjects(),
      teams: this.getSelectedTeams()
    };
  }
  
  applyFilters(filters) {
    // Apply project filters
    if (filters.projects) {
      this.projects.forEach(p => {
        p.selected = filters.projects.includes(p.id);
      });
      this.bus.emit(ProjectEvents.CHANGED, this.projects);
    }
    
    // Apply team filters
    if (filters.teams) {
      this.teams.forEach(t => {
        t.selected = filters.teams.includes(t.id);
      });
      this.bus.emit(TeamEvents.CHANGED, this.teams);
    }
    
    this.bus.emit(FeatureEvents.UPDATED);
  }
  
  // ===== Utility Methods =====
  
  reset() {
    this.selectAllProjects();
    this.selectAllTeams();
  }
}
