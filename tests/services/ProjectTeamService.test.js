import { expect } from '@esm-bundle/chai';
import { ProjectTeamService } from '../../www/js/services/ProjectTeamService.js';

describe('ProjectTeamService', () => {
  let service;
  let mockBus;
  let emitCalls;

  beforeEach(() => {
    emitCalls = [];
    mockBus = {
      emit: (event, data) => {
        emitCalls.push({ event, data });
      },
      on: () => {}
    };
    service = new ProjectTeamService(mockBus);
  });

  describe('initFromBaseline', () => {
    it('should initialize projects and teams from baseline', () => {
      const baselineProjects = [
        { id: 'p1', name: 'Project 1' },
        { id: 'p2', name: 'Project 2' }
      ];
      const baselineTeams = [
        { id: 't1', name: 'Team 1' },
        { id: 't2', name: 'Team 2' }
      ];

      service.initFromBaseline(baselineProjects, baselineTeams);

      expect(service.projects).to.have.lengthOf(2);
      expect(service.teams).to.have.lengthOf(2);
      expect(service.projects[0].id).to.equal('p1');
      expect(service.teams[0].id).to.equal('t1');
    });

    it('should create working copies without mutating baseline', () => {
      const baselineProjects = [{ id: 'p1', name: 'Project 1' }];
      service.initFromBaseline(baselineProjects, []);
      service.projects[0].selected = true;
      expect(baselineProjects[0].selected).to.be.undefined;
    });
  });

  describe('refreshFromBaseline', () => {
    it('should preserve selection state when refreshing', () => {
      const baselineProjects = [
        { id: 'p1', name: 'Project 1' },
        { id: 'p2', name: 'Project 2' }
      ];
      
      service.initFromBaseline(baselineProjects, []);
      service.setProjectSelected('p1', true);

      const newBaselineProjects = [
        { id: 'p1', name: 'Project 1 Updated' },
        { id: 'p2', name: 'Project 2' }
      ];

      service.refreshFromBaseline(newBaselineProjects, []);

      expect(service.projects[0].selected).to.be.true;
      expect(service.projects[0].name).to.equal('Project 1 Updated');
      expect(service.projects[1].selected).to.be.false;
    });

    it('should handle new projects added in refresh', () => {
      service.initFromBaseline([{ id: 'p1', name: 'Project 1' }], []);
      service.refreshFromBaseline([
        { id: 'p1', name: 'Project 1' },
        { id: 'p2', name: 'Project 2' }
      ], []);

      expect(service.projects).to.have.lengthOf(2);
    });
  });

  describe('setProjectSelected', () => {
    beforeEach(() => {
      service.initFromBaseline([
        { id: 'p1', name: 'Project 1' },
        { id: 'p2', name: 'Project 2' }
      ], []);
    });

    it('should set project selection and emit event', () => {
      const result = service.setProjectSelected('p1', true);

      expect(result).to.be.true;
      expect(service.projects[0].selected).to.be.true;
      expect(emitCalls).to.have.lengthOf(1);
      expect(emitCalls[0].event.toString()).to.include('projects');
    });

    it('should return false for non-existent project', () => {
      const result = service.setProjectSelected('p99', true);
      expect(result).to.be.false;
      expect(emitCalls).to.have.lengthOf(0);
    });

    it('should handle deselection', () => {
      service.setProjectSelected('p1', true);
      emitCalls = [];
      service.setProjectSelected('p1', false);

      expect(service.projects[0].selected).to.be.false;
      expect(emitCalls).to.have.lengthOf(1);
    });
  });

  describe('setTeamSelected', () => {
    beforeEach(() => {
      service.initFromBaseline([], [
        { id: 't1', name: 'Team 1' },
        { id: 't2', name: 'Team 2' }
      ]);
    });

    it('should set team selection and emit event', () => {
      const result = service.setTeamSelected('t1', true);

      expect(result).to.be.true;
      expect(service.teams[0].selected).to.be.true;
      expect(emitCalls).to.have.lengthOf(1);
      expect(emitCalls[0].event.toString()).to.include('teams');
    });

    it('should return false for non-existent team', () => {
      const result = service.setTeamSelected('t99', true);
      expect(result).to.be.false;
      expect(emitCalls).to.have.lengthOf(0);
    });
  });

  describe('getSelectedProjectIds', () => {
    it('should return selected project IDs', () => {
      service.initFromBaseline([
        { id: 'p1', name: 'Project 1' },
        { id: 'p2', name: 'Project 2' },
        { id: 'p3', name: 'Project 3' }
      ], []);

      service.setProjectSelected('p1', true);
      service.setProjectSelected('p3', true);

      const selected = service.getSelectedProjectIds();
      expect(selected).to.have.lengthOf(2);
      expect(selected).to.include('p1');
      expect(selected).to.include('p3');
      expect(selected).to.not.include('p2');
    });

    it('should return empty array when no selections', () => {
      service.initFromBaseline([{ id: 'p1' }], []);
      expect(service.getSelectedProjectIds()).to.have.lengthOf(0);
    });
  });

  describe('getSelectedTeamIds', () => {
    it('should return selected team IDs', () => {
      service.initFromBaseline([], [
        { id: 't1', name: 'Team 1' },
        { id: 't2', name: 'Team 2' }
      ]);

      service.setTeamSelected('t1', true);

      const selected = service.getSelectedTeamIds();
      expect(selected).to.have.lengthOf(1);
      expect(selected).to.include('t1');
    });
  });

  describe('captureCurrentFilters', () => {
    it('should capture current filter state', () => {
      service.initFromBaseline([
        { id: 'p1', name: 'Project 1' },
        { id: 'p2', name: 'Project 2' }
      ], [
        { id: 't1', name: 'Team 1' }
      ]);

      service.setProjectSelected('p1', true);
      service.setTeamSelected('t1', true);

      const filters = service.captureCurrentFilters();

      expect(filters.projects).to.deep.equal(['p1']);
      expect(filters.teams).to.deep.equal(['t1']);
    });

    it('should return empty arrays when nothing selected', () => {
      service.initFromBaseline([{ id: 'p1' }], [{ id: 't1' }]);
      
      const filters = service.captureCurrentFilters();
      
      expect(filters.projects).to.have.lengthOf(0);
      expect(filters.teams).to.have.lengthOf(0);
    });
  });

  describe('computeFeatureOrgLoad', () => {
    beforeEach(() => {
      service.initFromBaseline([], [
        { id: 't1', name: 'Team 1' },
        { id: 't2', name: 'Team 2' },
        { id: 't3', name: 'Team 3' }
      ]);
      service.setTeamSelected('t1', true);
      service.setTeamSelected('t2', true);
    });

    it('should compute org load based on selected teams', () => {
      const feature = {
        capacity: [
          { team: 't1', capacity: 50 },
          { team: 't2', capacity: 30 },
          { team: 't3', capacity: 20 }
        ]
      };

      const orgLoad = service.computeFeatureOrgLoad(feature);
      
      // (50 + 30) / 3 = 26.7%
      expect(orgLoad).to.equal('26.7%');
    });

    it('should handle features with no capacity', () => {
      const feature = { capacity: [] };
      const orgLoad = service.computeFeatureOrgLoad(feature);
      expect(orgLoad).to.equal('0.0%');
    });

    it('should handle case with no teams', () => {
      const serviceNoTeams = new ProjectTeamService(mockBus);
      serviceNoTeams.initFromBaseline([], []);
      
      const feature = { capacity: [{ team: 't1', capacity: 100 }] };
      const orgLoad = serviceNoTeams.computeFeatureOrgLoad(feature);
      
      // 0 / 1 = 0% (no matching teams)
      expect(orgLoad).to.equal('0.0%');
    });

    it('should only count selected teams', () => {
      const feature = {
        capacity: [
          { team: 't1', capacity: 60 },
          { team: 't2', capacity: 30 },
          { team: 't3', capacity: 90 }
        ]
      };

      // Only t1 and t2 are selected
      const orgLoad = service.computeFeatureOrgLoad(feature);
      
      // (60 + 30) / 3 = 30%
      expect(orgLoad).to.equal('30.0%');
    });
  });

  describe('getProjects and getTeams', () => {
    it('should return projects array', () => {
      const projects = [{ id: 'p1' }];
      service.initFromBaseline(projects, []);
      
      expect(service.getProjects()).to.deep.equal([{ id: 'p1' }]);
    });

    it('should return teams array', () => {
      const teams = [{ id: 't1' }];
      service.initFromBaseline([], teams);
      
      expect(service.getTeams()).to.deep.equal([{ id: 't1' }]);
    });
  });
});
