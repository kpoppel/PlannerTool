# History & Revision Data

PlannerTool can show historical revisions for work items to help you inspect when dates or iterations changed.

## What it shows
In the featureboard the tool displays two lines per card: One line depicting start state values and changes to start date, and one line depicting changes to end date over time.
Circles on the lines display where the task has move over time.  Hovering over a circle displays more information on who move the dates.

The information is useful when tracking down the lifecycle of work.  Items which moves around a lot could be unlikely to be very important, or difficult to break down into understandable work.

## How to use
1. Choose projects to view history data for
2. Open the History plugin (if enabled) from the Top Menu → Tools.  The toolbox will open and show the progress of retrieving historical data from the server.
3. Use the "Refresh cache" button to force a fresh fetch from Azure DevOps if recent changes are missing. In general you should not need to click this. Data is refreshed with a current time to lige of 24 hours.
