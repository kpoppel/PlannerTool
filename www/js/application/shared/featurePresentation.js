export function isAnchorPresentation(feature) {
  const presentation = feature.presentation;
  return presentation !== undefined
    && presentation.renderType === 'anchor'
    && presentation.sourceState === feature.state
    && !feature.start
    && !feature.end
    && !feature.iterationPath;
}

export function hasTimelinePlacement(feature) {
  return isAnchorPresentation(feature) || Boolean(feature.start && feature.end);
}

export function getTimelineStart(feature) {
  return isAnchorPresentation(feature) ? feature.presentation.date : feature.start;
}

export function getTimelineEnd(feature) {
  return isAnchorPresentation(feature) ? feature.presentation.date : feature.end;
}