# Initial user setup

On your first visit, enroll your account and save the account key before
continuing. On another browser or after sign-out, use the same Enrollment form
with your latest account key, then save its replacement. See
[Account Access](account_access.md) for enrollment, deletion, and administrator
reset instructions.

## Configuration

Open the gear (Settings) menu and choose **Configuration** to set your personal preferences. Server, plan and team settings are managed by your administrator. Azure DevOps access comes from your organization sign-in; PlannerTool does not use Personal Access Tokens (PATs).

![Configuration dialog](img/config_modal.png)

Fields
- Account email: the signed-in account identity, displayed as non-editable text.
- Remembered browsers: lists the browsers that remember your account; use **Refresh device list** to update it. See [Account Access](account_access.md) to revoke a browser.
- Autosave interval (minutes, 0=off): saves changed editable scenarios to your account at this interval. This is a browser preference; it does not publish changes to Azure DevOps. See [Scenarios & Saving](scenarios.md).
- Allocation unit: enter allocations in Percent (default), Man-days or Hours. Hours reflect each team's workforce project-hour budget. This is a browser-local preference.
- Letter shortcuts: enables or disables the plain-letter board shortcuts in this browser.

Buttons: **Sign out**, **Delete account** (see [Account Access](account_access.md)), **Save** and **Close**.

After enrollment or sign-in you should see the projects and teams defined on the server. If this works, you are set for using the application.

### Tips
- If projects or teams do not appear, refresh the browser.
- If refresh or write operations against Azure DevOps fail, sign in again and check your Azure DevOps permissions (Work Items read/write, Wiki read/write).

### I cannot refresh delivery plan markers
You need to have the right permission in Azure DevOps: "Manage Delivery Plans"
