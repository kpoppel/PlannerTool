# PlannerTool Help

Welcome to PlannerTool.
This is a tool developed by Kim Poulsen starting 2025 to work around planning shortcomings
in Azure Devops and eliminating Excel as a planning tool. The tool is context specific in that
it specifically addresses a need to balance task load on a number of development teams across
projects and features.  The tool is however not dependent on having balancing data to be useful.
Specifying projects alone will give a graphically pleasing way to see flow of work including
their dependencies if specified.

# Initial user setup

At first you will not see a lot, even if the server side is configured. Get started as follows:

1. Open the configuration dialog. Enter your email address, and your personal access token (PAT)
   from Azure Devops. If you don't know how to get a PAT, see the section about this below.
2. Save the configuration.

Now you should reload the page and projects defined on the server and teams should be displayed.

# Features
The tool has several useful features:

- Serverside configuration of projects and teams
- Ability to drill down to selected projects and teams
- Different modes to show cards and details
- Ability to make scenarios (currently not saved and under development)
- Ability to write adjusted dates to Azure
- Ability to interpret load estimations from loaded tasks from Azure

The graph area can display load on individul projects and teams, or combined views. Load calculations
are based off a calculation per day of all tasks scheduled on that day per team. Project load is the
sum of all team's load.  A team's organisation load is dependent on the number of teams, each team
count 1/N of the organisation load for N teams.
 The rationale is that it does not matter if a team has 3 or 20 members if it is 100% loaded. In either
case it cannot absorb more work.  To fix a permanently overloaded team, move work out of the team or
make it larger so the estimated team loads can be adjusted down.  The best solution however is to use
the tool to schedule work better so the load is distributed better in time.
  
## Left Side panel
This panel is the main control center. Select viewoptions and which teams and projects to display.

### View Options

The options include:

- Display options:
    - Condense cards
      Hide information on the cards to make them smaller. This is a great way to overview more
      items at once.
    - Show dependencies
      Add dependency display to the cards to see if a task depends on another.
      This feature requires the task to have a "Relates" or "Predecessor" of "Successor" link. (not implemented yet)
- Graphing options:
  The graph area can show two types of data: how much load the projects contribute to the total organisation load.
    - Team Load
      Display the team load situation. (under development)
    - Project Load
      Display the project load on the organisation. If several projects are selected they stack up and it can
      be evaluated if projects are being served according to plan, or if one takes too much proirity from other devliveries.
- Sorting options:
  When dragging cards the tool can display earliest jobs first always, or leave the cards sorted according to the
  rank in Azure DevOps.
    - Date
      Display cards sorted by earliest start date
    - Rank
      Display in teh sequence coming from the task database
- Filtering options:
  For better high-level oveview it is possible to show level 1 and level 2 tasks alone or together. It is a great way
  to reduce what is being looked at while drilling down into balancing scenarios.
    - Features
    - Epics

### Projects

### Teams

### Scenarios

## Graph Area

## Card Display Area
The card area is the main part of the tool. Each card represents a task in the task database.

Navigation options:
- Viewing card placement can happen by clicking and dragging the background.
- Cards can be clicked to display detailed data from the task database. (See the section on this)
- Cards can be dragged by clicking and holding while dragging.  If an Epic is moved, all children (Features) will move with it.
- Cards can be resized by dragging the right side drag bar.

These options are available in both normal and condensed card view modes.

## Right Side Panel

# Specifying team load in a task
To utilise the team load function you need to prepare the task for this. In each Epic and Feature ass a block like this in the
description field:

  [PlannerTool Team Loads]
  <name>: <percent_load>
  ...
  [/PlannerTool Team Loads]

Team names are defined in the server backend currently and you can use either the full name as seen in the user interface, or a short
form.  It is only necessary to include the teams actually participating, so usually there is mostly just a few lines here.

The long form template:

  [PlannerTool Team Capacity]
  Integration Team: 0
  System & Framework: 0
  Bluetooth: 0
  Hardware Abstraction: 0
  Connectivity & Interactions: 0
  Signal Processing: 0
  D chipset: 0
  TestOps & Pipelines: 0
  Tooling: 0
  Architecture: 0
  Requirements: 0
  [/PlannerTool Team Capacity]

or this format using the short form names:

  [PlannerTool Team Capacity]
  INT: 0
  SYS: 0
  BT : 0
  C&I: 0
  SIP: 0
  HAL: 0
  DCS: 0
  TOP: 0
  TOL: 0
  ARC: 0
  REQ: 0
  [/PlannerTool Team Capacity]

# FAQ

## How do I generate a Personal Access Token (PAT)?
When you are logged into Azure devops do as follows:

1. click the "User Settings" button next to your progfile image.
2. Select "Personal access tokens".
3. Generate a token by clicking "+ New token".
4. Give it a name "PlannerTool", and assign all scopes to it. It was not been tested what the
   minimum scope selection is at this point, so just select them all.
5. Set the expiry date to as far in the future it is allowed.
6. Save the token and copy the string to a safe place.