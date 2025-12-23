import { expect } from '@open-wc/testing';
import { BaselineStore } from '../../www/js/services/BaselineStore.js';

describe('BaselineStore Service (consolidated)', () => {
  let store;
  
  beforeEach(() => {
    store = new BaselineStore();
  });
  
  it('should store projects', () => {
    const projects = [{ id: 'p1', name: 'Project 1' }];
    
    store.setProjects(projects);
    
    expect(store.getProjects()).to.deep.equal(projects);
  });
  
  it('should store teams', () => {
    const teams = [{ id: 't1', name: 'Team 1' }];
    
    store.setTeams(teams);
    
    expect(store.getTeams()).to.deep.equal(teams);
  });
  
  it('should store features', () => {
    const features = [{ id: 'f1', title: 'Feature 1' }];
    
    store.setFeatures(features);
    
    expect(store.getFeatures()).to.deep.equal(features);
  });
  
  it('should load all baseline data at once', () => {
    const data = {
      projects: [{ id: 'p1' }],
      teams: [{ id: 't1' }],
      features: [{ id: 'f1' }]
    };
    
    store.loadBaseline(data);
    
    expect(store.getProjects()).to.deep.equal(data.projects);
    expect(store.getTeams()).to.deep.equal(data.teams);
    expect(store.getFeatures()).to.deep.equal(data.features);
  });
  
  it('should preserve original feature order', () => {
    const features = [
      { id: 'f3', originalRank: 3 },
      { id: 'f1', originalRank: 1 },
      { id: 'f2', originalRank: 2 }
    ];
    
    store.setFeatures(features);
    
    const order = store.getOriginalOrder();
    expect(order).to.deep.equal(['f3', 'f1', 'f2']);
  });
  
  it('should return immutable copies', () => {
    const projects = [{ id: 'p1', name: 'Original' }];
    store.setProjects(projects);
    
    const retrieved = store.getProjects();
    retrieved[0].name = 'Modified';
    
    expect(store.getProjects()[0].name).to.equal('Original');
  });
  
  it('should clear all baseline data', () => {
    store.loadBaseline({
      projects: [{ id: 'p1' }],
      teams: [{ id: 't1' }],
      features: [{ id: 'f1' }]
    });
    
    store.clear();
    
    expect(store.getProjects()).to.deep.equal([]);
    expect(store.getTeams()).to.deep.equal([]);
    expect(store.getFeatures()).to.deep.equal([]);
  });
});
