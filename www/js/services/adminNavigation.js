const ADMIN_SECTIONS = [
  { id: 'server', label: 'Server', permissions: [] },
  { id: 'data-sources', label: 'Data Sources', permissions: [] },
  { id: 'users', label: 'Users', permissions: [] },
  { id: 'plugins', label: 'Plugins', permissions: [] },
  { id: 'workforce', label: 'Workforce',
    permissions: ['manage_workforce_teams', 'manage_workforce_costs'] },
  { id: 'utilities', label: 'Utilities', permissions: [] },
];

const ADO_VIEWS = [
  { id: 'projects', label: 'Plans', permissions: ['manage_projects'] },
  { id: 'ado-processes', label: 'Azure DevOps Processes', permissions: ['manage_projects'] },
  { id: 'global-project-settings', label: 'Global Project Settings', permissions: ['manage_projects'] },
  { id: 'iterations', label: 'Iterations', permissions: ['manage_iterations'] },
  { id: 'area-mappings', label: 'Area Mappings', permissions: [] },
  { id: 'ado-connection', label: 'Connection', permissions: [] },
];

const LOCAL_VIEWS = [
  { id: 'local-projects', label: 'Local Projects', permissions: ['manage_projects'] },
  { id: 'local-catalogue', label: 'Catalogue', permissions: ['manage_projects'] },
  { id: 'local-markers', label: 'Markers', permissions: ['manage_projects'] },
  { id: 'local-iterations', label: 'Iterations', permissions: ['manage_iterations'] },
];

export function getAdminSections(permissions, taskBackendId, includeBackupSnapshots = false) {
  const isAdmin = permissions.includes('admin');
  const canAccess = (entry) => isAdmin
    || entry.permissions.some((permission) => permissions.includes(permission));
  const sections = ADMIN_SECTIONS.filter(canAccess);
  const hub = taskBackendId === 'ado'
    ? { id: 'ado', label: 'Azure DevOps', views: ADO_VIEWS }
    : taskBackendId === 'local'
      ? { id: 'local', label: 'Local', views: LOCAL_VIEWS }
      : null;
  if (hub !== null) {
    const views = hub.views.filter(canAccess);
    if (views.length > 0) {
      const position = sections.findIndex((section) => section.id === 'workforce');
      sections.splice(position === -1 ? sections.length : position, 0, { ...hub, views });
    }
  }
  if (isAdmin && includeBackupSnapshots) {
    sections.push({ id: 'backup-snapshots', label: 'Backup Snapshots', permissions: [] });
  }
  return sections;
}