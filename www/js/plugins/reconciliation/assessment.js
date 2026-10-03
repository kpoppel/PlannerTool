import { assessSchedule } from './scheduleAssessment.js';
import { assessQuality } from './qualityAssessment.js';

export function assessReconciliation({ features, sourceFeatures, scopeIds, ...context }) {
  const featuresById = new Map(features.map((feature) => [String(feature.id), feature]));
  const sourceById = new Map(sourceFeatures.map((feature) => [String(feature.id), feature]));
  const sourceIssues = new Map(assessSchedule(sourceById, scopeIds).map((issue) => [issue.id, issue]));
  const schedule = assessSchedule(featuresById, scopeIds).map((issue) => {
    const source = sourceIssues.get(issue.id);
    const change = !source ? 'new'
      : issue.earlyDays > source.earlyDays || issue.lateDays > source.lateDays ? 'worsened' : 'existing';
    return { ...issue, change };
  });
  return [...schedule, ...assessQuality({ featuresById, scopeIds, ...context })];
}