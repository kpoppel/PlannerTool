# Initial user setup

At first you will not see a lot, even if the server side is configured. Get started as follows:

1. Open the configuration dialog. Enter your email address, and your personal access token (PAT) from Azure Devops. If you don't know how to get a PAT, see below.
2. Save the configuration.

Now you should reload the page and projects defined on the server and teams should be displayed.

## How do I generate a Personal Access Token (PAT)?
When you are logged into Azure devops do as follows:

1. Click the "User Settings" button next to your profile image.
2. Select "Personal access tokens".
3. Generate a token by clicking "+ New token".
4. Give it a name "PlannerTool", and assign minimum the Task management permission read/write scope to it.
5. Set the expiry date to as far in the future it is allowed.
6. Save the token and copy the string to a safe place.

## I cannot refresh delivery plan markers
You need to have the right permission in Azure DevOps: "Manage Delivery Plans"
