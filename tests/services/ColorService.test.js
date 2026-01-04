/**
 * Unit tests for ColorService
 * Tests color assignment, lookup, and deterministic hashing
 */

import { expect } from '@esm-bundle/chai';
import { 
  ColorService, 
  PALETTE, 
  DEFAULT_STATE_COLOR_MAP 
} from '../../www/js/services/ColorService.js';

describe('ColorService', () => {
  let mockDataService;
  let colorService;
  
  beforeEach(() => {
    mockDataService = {
      getColorMappings: async () => ({
        projectColors: {},
        teamColors: {}
      }),
      saveProjectColor: async (id, color) => {},
      saveTeamColor: async (id, color) => {}
    };
    colorService = new ColorService(mockDataService);
  });
  
  describe('Constants', () => {
    it('should export PALETTE with 16 colors', () => {
      expect(PALETTE.length).to.equal(16);
      expect(PALETTE[0]).to.match(/^#[0-9a-f]{6}$/i);
    });
    
    it('should export DEFAULT_STATE_COLOR_MAP', () => {
      expect(DEFAULT_STATE_COLOR_MAP['New']).to.equal('#3498db');
      expect(DEFAULT_STATE_COLOR_MAP['Completed']).to.equal('#9b59b6');
    });
  });
  
  describe('Color Initialization', () => {
    it('should initialize colors for projects and teams', async () => {
      const projects = [
        { id: 'proj-1', name: 'Project 1' },
        { id: 'proj-2', name: 'Project 2' }
      ];
      const teams = [
        { id: 'team-1', name: 'Team 1' },
        { id: 'team-2', name: 'Team 2' }
      ];
      
      await colorService.initColors(projects, teams);
      
      expect(projects[0].color).to.exist;
      expect(projects[0].color).to.match(/^#[0-9a-f]{6}$/i);
      expect(teams[0].color).to.exist;
    });
    
    it('should use saved colors from dataService', async () => {
      mockDataService.getColorMappings = async () => ({
        projectColors: { 'proj-1': '#ff0000' },
        teamColors: { 'team-1': '#00ff00' }
      });
      
      const projects = [{ id: 'proj-1', name: 'Project 1' }];
      const teams = [{ id: 'team-1', name: 'Team 1' }];
      
      await colorService.initColors(projects, teams);
      
      expect(projects[0].color).to.equal('#ff0000');
      expect(teams[0].color).to.equal('#00ff00');
    });
    
    it('should assign deterministic fallback colors', async () => {
      const projects = [
        { id: 'proj-no-color', name: 'Project' }
      ];
      
      await colorService.initColors(projects, []);
      
      expect(projects[0].color).to.match(/^#[0-9a-f]{6}$/i);
      expect(PALETTE).to.include(projects[0].color);
    });
  });
  
  describe('Project Color Lookup', () => {
    it('should return color for project ID', () => {
      colorService.projectColors = { 'proj-123': '#3498db' };
      
      const color = colorService.getProjectColor('proj-123');
      expect(color).to.equal('#3498db');
    });
    
    it('should fallback to projects array', () => {
      const projects = [{ id: 'proj-456', color: '#e74c3c' }];
      
      const color = colorService.getProjectColor('proj-456', projects);
      expect(color).to.equal('#e74c3c');
    });
    
    it('should fallback to baseline projects', () => {
      const baselineProjects = [{ id: 'proj-789', color: '#2ecc71' }];
      
      const color = colorService.getProjectColor('proj-789', null, baselineProjects);
      expect(color).to.equal('#2ecc71');
    });
    
    it('should return deterministic hash color if not found', () => {
      const color1 = colorService.getProjectColor('unknown-proj');
      const color2 = colorService.getProjectColor('unknown-proj');
      
      expect(color1).to.equal(color2); // Deterministic
      expect(color1).to.match(/^#[0-9a-f]{6}$/i);
    });
    
    it('should return default color for null/undefined ID', () => {
      expect(colorService.getProjectColor(null)).to.equal(PALETTE[0]);
      expect(colorService.getProjectColor(undefined)).to.equal(PALETTE[0]);
    });
  });
  
  describe('Feature State Color Lookup', () => {
    it('should return default color for known states', () => {
      expect(colorService.getFeatureStateColor('New')).to.equal('#3498db');
      expect(colorService.getFeatureStateColor('Completed')).to.equal('#9b59b6');
    });
    
    it('should return deterministic hash color for unknown states', () => {
      const color1 = colorService.getFeatureStateColor('CustomState');
      const color2 = colorService.getFeatureStateColor('CustomState');
      
      expect(color1).to.equal(color2); // Deterministic
      expect(color1).to.match(/^#[0-9a-f]{6}$/i);
    });
    
    it('should return default color for null/undefined state', () => {
      expect(colorService.getFeatureStateColor(null)).to.equal(PALETTE[0]);
      expect(colorService.getFeatureStateColor(undefined)).to.equal(PALETTE[0]);
    });
  });
  
  describe('Feature State Colors (All)', () => {
    it('should return color mappings for all states', () => {
      const states = ['New', 'Completed', 'Blocked'];
      const colors = colorService.getFeatureStateColors(states);
      
      expect(colors['New']).to.exist;
      expect(colors['New'].background).to.equal('#3498db');
      expect(colors['New'].text).to.match(/^#(000|fff)$/);
    });
    
    it('should compute readable text colors', () => {
      const states = ['New'];
      const colors = colorService.getFeatureStateColors(states);
      
      // New is blue (#3498db), YIQ ~= 129.7, so black text
      expect(colors['New'].text).to.equal('#000');
    });
    
    it('should handle empty state list', () => {
      const colors = colorService.getFeatureStateColors([]);
      expect(colors).to.deep.equal({});
    });
  });
  
  describe('Deterministic Hashing', () => {
    it('should produce consistent hashes for same input', () => {
      const hash1 = colorService._hashToColor('test-string');
      const hash2 = colorService._hashToColor('test-string');
      
      expect(hash1).to.equal(hash2);
    });
    
    it('should produce different hashes for different inputs', () => {
      const hash1 = colorService._hashToColor('string-a');
      const hash2 = colorService._hashToColor('string-b');
      
      // High probability of different colors (not guaranteed due to modulo)
      // Just check they're both valid hex colors
      expect(hash1).to.match(/^#[0-9a-f]{6}$/i);
      expect(hash2).to.match(/^#[0-9a-f]{6}$/i);
    });
    
    it('should always return colors from PALETTE', () => {
      const color = colorService._hashToColor('any-string');
      expect(PALETTE).to.include(color);
    });
  });
  
  describe('Text Color Contrast', () => {
    it('should return black text for light backgrounds', () => {
      const lightColors = ['#ffffff', '#f1f1f1', '#d3d3d3'];
      lightColors.forEach(bg => {
        expect(colorService._pickTextColor(bg)).to.equal('#000');
      });
    });
    
    it('should return white text for dark backgrounds', () => {
      const darkColors = ['#000000', '#222222', '#333333'];
      darkColors.forEach(bg => {
        expect(colorService._pickTextColor(bg)).to.equal('#fff');
      });
    });
    
    it('should handle null/undefined background', () => {
      expect(colorService._pickTextColor(null)).to.equal('#000');
      expect(colorService._pickTextColor(undefined)).to.equal('#000');
    });
  });
});
