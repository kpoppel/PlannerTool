# Scenarios & Saving

## Baseline and scenarios

- **Baseline** is the live data loaded from Azure DevOps. It is always read-only: cards cannot be dragged and the Details panel cannot edit.
- A **scenario** is your own copy where you can change dates, allocations, states, tags and groups without touching the source data. Scenarios are stored on the server for your account.

## Scenario menu

![Scenario menu](img/menu_scenario.png)

- Click a scenario to make it active. The active scenario is shown as a badge on the Scenario menu.
- **🔄** (Baseline): refresh the baseline data from the server.
- **📋 Copy Scenario**: copy the active scenario (Baseline or another scenario) into a new scenario. The suggested name is the date plus a number, for example "07-15 Scenario 1".

Your own scenarios have these buttons:

- **⚠️**: the scenario has unsaved changes.
- **💾 Save scenario changes**
- **☁️ Publish scenario**: shown on the active scenario when it has changes. Opens the [Review Modal](review_modal.md).
- **✏️ Rename scenario**
- **🗑️ Delete scenario**

![Scenario with unsaved changes](img/menu_scenario_changes.png)

![Copying a scenario](img/scenario_clone_modal.png)

## Workflow

1. Open **Scenario → 📋 Copy Scenario**, enter a name and click **Clone**. The new scenario becomes active.
2. Make changes: drag cards, edit dates, states and allocations in the [Details Panel](details.md), or organise [groups](groups.md).
3. Save with 💾, or set an autosave interval in [Configuration](getting_started.md#configuration). Unsaved scenarios show ⚠️ until saved.
4. Use ☁️ **Publish scenario** to choose which changes to write to Azure DevOps.

The [Reconciliation](plugin_reconciliation.md) panel also has **Save scenario** and **Publish scenario** buttons.

## Safety notes

- Autosave stores scenario changes in your account; it never publishes them to Azure DevOps. Only changes you select in the Review Modal are written to Azure DevOps.
- Scenarios shared with you as read-only cannot be edited; copy them to make your own version.
