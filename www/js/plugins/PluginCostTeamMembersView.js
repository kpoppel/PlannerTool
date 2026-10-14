import { html } from '../vendor/lit.js';

export function renderTeamMembersView(component) {
  const metadata = component.costTeams;
  if (metadata === null || metadata.catalogue.length === 0) {
    return html`<div class="empty-state"><h3>No Workforce</h3></div>`;
  }
  const suppliers = new Map(metadata.suppliers.map((supplier) => [supplier.id, supplier]));
  const currency = (amount) => amount.toLocaleString(undefined,
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return html`<div class="workforce-bases">
    ${metadata.catalogue.map((definition) => {
      const basis = definition.kind === 'team'
        ? metadata.teams[definition.id] : metadata.groups[definition.id];
      const memberDefinitions = definition.kind === 'team' ? [definition]
        : metadata.catalogue.filter((entry) => entry.kind === 'team' && entry.group_id === definition.id);
      const expanded = component.expandedTeams.has(definition.id);
      return html`<section style="border-bottom:1px solid #e6e6e6; padding:10px 0">
        <button class="team-summary" aria-expanded=${expanded}
          style="border:0;width:100%;background:transparent;text-align:left"
          @click=${() => component.toggleTeam(definition.id)}>
          <span class="team-name">${expanded ? '\u25be' : '\u25b8'} ${definition.name}
            ${definition.archived ? '(archived)' : ''}</span>
          <span class="team-metrics">
            <span>Internal FTE: ${basis.internal.fte}</span>
            <span>External FTE: ${basis.external.fte}</span>
            <span>Internal hours: ${basis.internal.monthly_hours}</span>
            <span>External hours: ${basis.external.monthly_hours}</span>
            <span>Internal cost: ${currency(basis.internal.monthly_cost)}</span>
            <span>External cost: ${currency(basis.external.monthly_cost)}</span>
          </span>
        </button>
        ${expanded ? html`<table class="table" style="width:100%">
          <thead><tr><th class="left">Team</th><th class="left">Supplier</th>
            <th class="left">Profile</th><th>Account</th><th>FTE</th><th>Hourly Rate</th>
            <th>Monthly Hours</th><th>Monthly Cost</th></tr></thead>
          <tbody>${memberDefinitions.flatMap((member) => metadata.teams[member.id].profiles.map((row) => {
            const supplier = suppliers.get(row.supplier_id);
            const profile = supplier.profiles.find((entry) => entry.id === row.profile_id);
            return html`<tr><td>${member.name}</td><td>${supplier.name}</td><td>${profile.name}</td>
              <td>${row.external ? 'External' : 'Internal'}</td><td>${row.fte}</td>
              <td>${currency(profile.hourly_rate)}</td><td>${row.monthly_hours}</td>
              <td>${currency(row.monthly_cost)}</td></tr>`;
          }))}</tbody>
        </table>` : ''}
      </section>`;
    })}
  </div>`;
}
