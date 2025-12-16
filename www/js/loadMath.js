//import { getTimelineMonths } from './timeline.js';

// function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
// function daysInMonth(d){ return new Date(d.getFullYear(), d.getMonth()+1, 0).getDate(); }

// function dateToIndex(months, date){
//   const start = months[0];
//   const msPerDay = 24*60*60*1000;
//   return Math.floor((date - start) / msPerDay);
// }

// export function aggregateDailyCapacity(features, teams, projects, flags, range){
//   const teamSet = new Set(teams.filter(t=>t.selected).map(t=>t.id));
//   const projectSet = new Set(projects.filter(p=>p.selected).map(p=>p.id));
//   const showEpics = !!flags.showEpics;
//   const showFeatures = !!flags.showFeatures;

//   const months = getTimelineMonths();
//   const startIdx = dateToIndex(months, range.startDate);
//   const endIdx = dateToIndex(months, range.endDate);
//   const days = new Map();

//   function add(dayIdx, teamId, inc){
//     if(!days.has(dayIdx)) days.set(dayIdx, {});
//     const bucket = days.get(dayIdx);
//     bucket[teamId] = (bucket[teamId] || 0) + inc;
//   }

//   const featuresByEpic = new Map();
//   for(const f of features){
//     if(f.type==='feature' && f.parentEpic){
//       if(!featuresByEpic.has(f.parentEpic)) featuresByEpic.set(f.parentEpic, []);
//       featuresByEpic.get(f.parentEpic).push(f);
//     }
//   }

//   for(const item of features){
//     const isEpic = item.type==='epic';
//     const inProject = projectSet.has(item.project);
//     if(!inProject) continue;

//     const start = new Date(item.start);
//     const end = new Date(item.end);
//     const itemStartIdx = dateToIndex(months, start);
//     const itemEndIdx = dateToIndex(months, end);

//     if(isEpic){
//       if(!showEpics) continue;
//       const children = featuresByEpic.get(item.id) || [];
//       const hasChildren = children.length>0;
//       const childRanges = showFeatures && hasChildren ? children.map(ch=>({ s: dateToIndex(months, new Date(ch.start)), e: dateToIndex(months, new Date(ch.end)) })) : [];
//       for(let d = Math.max(startIdx, itemStartIdx); d <= Math.min(endIdx, itemEndIdx); d++){
//         const coveredByChild = showFeatures && childRanges.some(r => d>=r.s && d<=r.e);
//         if(coveredByChild) continue;
//         for(const tl of item.capacity){ if(!teamSet.has(tl.team)) continue; add(d, tl.team, tl.capacity); }
//       }
//     } else {
//       if(!showFeatures) continue;
//       for(let d = Math.max(startIdx, itemStartIdx); d <= Math.min(endIdx, itemEndIdx); d++){
//         for(const tl of item.capacity){ if(!teamSet.has(tl.team)) continue; add(d, tl.team, tl.capacity); }
//       }
//     }
//   }
//   return days; // Map(dayIdx -> { teamId: rawPercent }) raw (not normalized)
// }

// export function computeOrganisationalCapacity(dayBucket){
//   // Sum team percentages for the day to get organisational load percentage.
//   // Future: factor team sizes, capacities, holidays, etc.
//   if(!dayBucket) return 0;
//   let total = 0;
//   for(const k of Object.keys(dayBucket)){
//     total += dayBucket[k] || 0;
//   }
//   return total; // percentage, may exceed 100
// }

// Extended computation producing normalized per-day team and project capacity spend.
// Normalization: each team's percent divided by global number of teams (selected or all? Requirement: divide by total number of teams globally).
// Returns an object with maps for team and project views plus per-day organisational totals.
// export function computeDailyCapacityMaps(features, teams, projects, flags, range){
//   //TODO clean: const rawTeamDayMap = aggregateDailyCapacity(features, teams, projects, flags, range);
//   const numTeamsGlobal = teams.length === 0 ? 1 : teams.length; // avoid div by zero
//   const teamDayMap = new Map(); // normalized team capacity (percent of org capacity)
//   const projectDayMap = new Map(); // normalized project capacity (aggregate of participating teams per project)
//   //TODO clean: const projectMeta = new Map(projects.map(p=>[p.id, p]));

//   // Build feature index by project to speed project aggregation
//   const projectFeatures = new Map();
//   for(const f of features){
//     if(!projectFeatures.has(f.project)) projectFeatures.set(f.project, []);
//     projectFeatures.get(f.project).push(f);
//   }

//   // Precompute timeline months & range indices for per-day iteration like aggregateDailyCapacity did
//   const months = getTimelineMonths();
//   function dateToIndex(months, date){
//     const start = months[0];
//     const msPerDay = 24*60*60*1000;
//     return Math.floor((date - start) / msPerDay);
//   }
//   const startIdx = dateToIndex(months, range.startDate);
//   const endIdx = dateToIndex(months, range.endDate);

//   // For project aggregation we must repeat epic overlap logic to avoid double counting.
//   const teamSetSelected = new Set(teams.filter(t=>t.selected).map(t=>t.id));
//   const projectSetSelected = new Set(projects.filter(p=>p.selected).map(p=>p.id));
//   const showEpics = !!flags.showEpics;
//   const showFeatures = !!flags.showFeatures;

//   const featuresByEpic = new Map();
//   for(const f of features){
//     if(f.type==='feature' && f.parentEpic){
//       if(!featuresByEpic.has(f.parentEpic)) featuresByEpic.set(f.parentEpic, []);
//       featuresByEpic.get(f.parentEpic).push(f);
//     }
//   }

//   function addNormalizedTeam(dayIdx, teamId, raw){
//     if(!teamDayMap.has(dayIdx)) teamDayMap.set(dayIdx, {});
//     const bucket = teamDayMap.get(dayIdx);
//     bucket[teamId] = (bucket[teamId] || 0) + (raw / numTeamsGlobal);
//   }
//   function addNormalizedProject(dayIdx, projectId, raw){
//     if(!projectDayMap.has(dayIdx)) projectDayMap.set(dayIdx, {});
//     const bucket = projectDayMap.get(dayIdx);
//     bucket[projectId] = (bucket[projectId] || 0) + (raw / numTeamsGlobal);
//   }

//   for(const item of features){
//     const isEpic = item.type==='epic';
//     if(!projectSetSelected.has(item.project)) continue;
//     const start = new Date(item.start);
//     const end = new Date(item.end);
//     const itemStartIdx = dateToIndex(months, start);
//     const itemEndIdx = dateToIndex(months, end);
//     if(isEpic){
//       if(!showEpics) continue;
//       const children = featuresByEpic.get(item.id) || [];
//       const hasChildren = children.length>0;
//       const childRanges = showFeatures && hasChildren ? children.map(ch=>({ s: dateToIndex(months, new Date(ch.start)), e: dateToIndex(months, new Date(ch.end)) })) : [];
//       for(let d=Math.max(startIdx,itemStartIdx); d<=Math.min(endIdx,itemEndIdx); d++){
//         const coveredByChild = showFeatures && childRanges.some(r=>d>=r.s && d<=r.e);
//         if(coveredByChild) continue;
//         for(const tl of item.capacity){
//           if(!teamSetSelected.has(tl.team)) continue; // respect team filter also in project view per requirement
//           addNormalizedTeam(d, tl.team, tl.capacity);
//           addNormalizedProject(d, item.project, tl.capacity);
//         }
//       }
//     } else {
//       if(!showFeatures) continue;
//       for(let d=Math.max(startIdx,itemStartIdx); d<=Math.min(endIdx,itemEndIdx); d++){
//         for(const tl of item.capacity){
//           if(!teamSetSelected.has(tl.team)) continue;
//           addNormalizedTeam(d, tl.team, tl.capacity);
//           addNormalizedProject(d, item.project, tl.capacity);
//         }
//       }
//     }
//   }

//   // Compute totals
//   const orgTotalsTeam = new Map();
//   const orgTotalsProject = new Map();
//   for(const [dayIdx, bucket] of teamDayMap.entries()){
//     orgTotalsTeam.set(dayIdx, Object.values(bucket).reduce((a,b)=>a+b,0));
//   }
//   for(const [dayIdx, bucket] of projectDayMap.entries()){
//     orgTotalsProject.set(dayIdx, Object.values(bucket).reduce((a,b)=>a+b,0));
//   }

//   console.log('Computed daily capacity maps', { teamDayMap, projectDayMap, orgTotalsTeam, orgTotalsProject, numTeamsGlobal });
//   return { teamDayMap, projectDayMap, orgTotalsTeam, orgTotalsProject, numTeamsGlobal };
// }
