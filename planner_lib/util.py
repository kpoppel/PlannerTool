def project_id_for_area_path(area_path: str, project_map: list) -> str | None:
    """Resolve an area path to its most-specific configured project identity."""
    normalized_area = area_path.strip('/\\').replace('/', '\\').casefold()
    matches = []
    for project in project_map:
        configured_area = project.get('area_path')
        if not configured_area:
            continue
        normalized_configured = configured_area.strip('/\\').replace('/', '\\').casefold()
        if (
            normalized_area == normalized_configured
            or normalized_area.startswith(normalized_configured + '\\')
            or normalized_configured.startswith(normalized_area + '\\')
        ):
            matches.append((len(normalized_configured), project.get('id')))
    if not matches:
        return None
    most_specific = max(length for length, _ in matches)
    owners = {project_id for length, project_id in matches if length == most_specific}
    return next(iter(owners)) if len(owners) == 1 else None
