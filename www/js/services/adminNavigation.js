const ADMIN_SECTIONS = [
  { id: 'server', label: 'Server', permissions: [] },
  { id: 'data-sources', label: 'Data Sources', permissions: [] },
  { id: 'users', label: 'Users', permissions: [] },
  { id: 'plugins', label: 'Plugins', permissions: [] },
  { id: 'projects', label: 'Plans', permissions: ['manage_projects'] },
  { id: 'ado-processes', label: 'Azure DevOps Processes', permissions: ['manage_projects'] },
  { id: 'global-project-settings', label: 'Global Project Settings', permissions: ['manage_projects'] },
  { id: 'workforce', label: 'Workforce',
    permissions: ['manage_workforce_teams', 'manage_workforce_costs'] },
  { id: 'area-mappings', label: 'Area Mappings', permissions: [] },
  { id: 'iterations', label: 'Iterations', permissions: ['manage_iterations'] },
  { id: 'utilities', label: 'Utilities', permissions: [] },
];

export function getAdminSections(permissions, includeBackupSnapshots = false) {
  const isAdmin = permissions.includes('admin');
  const sections = ADMIN_SECTIONS.filter((section) => isAdmin
    || section.permissions.some((permission) => permissions.includes(permission)));
  if (isAdmin && includeBackupSnapshots) {
    sections.push({ id: 'backup-snapshots', label: 'Backup Snapshots', permissions: [] });
  }
  return sections;
}