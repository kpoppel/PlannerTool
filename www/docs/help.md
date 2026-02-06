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
are based off a calculation per day of all tasks scheduled on that day per team. Project capcacity is the
sum of all team's capacity allocations.  A team's organisation capacity is dependent on the number of
teams, each team count 1/N of the organisational capacity allocation for N teams.
 The rationale is that it does not matter if a team has 3 or 20 members if it is 100% loaded. In either
case it cannot absorb more work.  To fix a permanently overbooked teams, move work out of the team or
make it larger so the estimated team capacity for a task can be adjusted down.  The best solution
however is to use the tool to schedule work better so the capacity is distributed better in time.

# Recommendation for using Azure DevOps consistently for best results.

These are the recommended guidelines for using states, types and area paths to get the most out of
both this software and vanilla Azure DevOps as far as building projects from a single platform where
multiple teams are involved.

## Use of states - semantics matter

Using any tool for planning requires discipline and compliance to some rules. The principle of
"garbage in - garbage out" applies in particular to task/issue tracking sytems like Jira and Azure DevOps.
In a workflow described by:

  New -> Defined -> Active -> Resolved -> Closed

Each state must convery specific information to the reader. For the purpose of this particular workflow, we
can define the states as follows:

- New: The task is registered as some future work. It may have a short description or just a title.
       Start and target dates are not set, and an effort estimate may not be present.
- Defined: The task has cycled through refinement and has an adequate description to allow spending more time
       towards breakdown the the level below (Epic to Feature, or Feature to Story). The task must have an
       estimate of capacity spend and start and target dates must be set initially. All of these may change
       as part of an iterative learning effort, but the task is plannable.
- Active: The task receives no longer updates which change the scope of it. Scope changes are expensive once
       teams are committed to the initial scope. The task remains active throughout development until it
       is ready for delivery (do have a Definition of Done for setting the quality bar). Dates may change.
       If capacity spending is changed the program takes this into account as an average effort for the duration
       of a task. Just remember a large spike for a team in the middle of a long task needs to be split out to
       keep the team effort data accurate - or just avoid spikes alltogether.
- Resolved: The task is ready for delivery. Delivery entails ensuring the DoD is complied to, the downstream
       teams have seen a demo, the feature is accepted and so on.  Only close a task once it is clear it fulfils
       the needs originally stated.
- Closed: The program does not fetch closed tasks as this is a forward planning tool. Closed means "done!".

When using the program and definitions like these, you can use the filters in the sidebar to consistently view
data of interest when building scenarios.

## Use of the hierarchy

For a hierarchy arranged as `Epic -> Feature/Enabler -> Story/Bug -> Task` it is recommended to 'reserve' hierarchy for
specific purposes.  Here the recommendation is to do as follows:

1. Epics are reserved for product deliveries.  These are the big picture blocks where multiple teams deliver their part
   to combine into a completed delivery.  Epics describe a wanted outcome from a combination of sub-systems in for example
   a software platform.
2. Features/Enablers, Stories/Bugs and Tasks are reserved for development teams. For a given Epic each development team has
   zero or more Features which defines the contribution(s) the team has.  Each Feature is broken down into as much detail
   as the team needs to ensure proper design and quality.

Do not mix these two by adding an Epic in one path as child of another Epic in another path even though this may be possible.

## Use of Azure DevOps 'area paths'

The recommendation is to have one path per product containing Epics related to that specific product. This makes it
easy to identify work related to a single product at a time.
For development teams it is likewise recommended to have one path per development backlog. If there are multiple teams
working from the same development backlog, do not create more paths as tasks will have less tendency to flow between
teams in the same domain.

# Detailed Feature Description

## Left Side panel
This panel is the main control center. Select viewoptions and which teams and projects to display.

### View Options

The options include:

- Display options:
    - Timeline scale
      Select the scale on which to view tasks. The naming reflects a conceptual scale, not 1 week, 1 month etc.
    - Condense cards
      Hide information on the cards to make them smaller. This is a great way to overview more
      items at once.
    - Show dependencies
      Add dependency display to the cards to see if a task depends on another.
      This feature requires the task to have a "Relates" or "Predecessor" of "Successor" link. (not implemented yet)
    - Show unassigned
      Filter tasks which have no capacity assigned. Some tasks may not have an estimation of capacity needed.
    - Show unplanned
      Filter tasks which have no dates assigned.  Some tasks may not be placed on the timeline.
- Graphing options:
  The graph area can show two types of data: how much load the projects contribute to the total organisation load.
    - Team
      Display the team capacity allocation situation. If several teams are selected they stack up and it can be
      evaluated if teams are being under/over-utilised.
    - Project
      Display the project allocations on the organisation. If several projects are selected they stack up and it can
      be evaluated if projects are being served according to plan, or if one takes too much proirity from other deliveries.
- Sorting options:
  When dragging cards the tool can display earliest jobs first always, or leave the cards sorted according to the
  rank in Azure DevOps.
    - Date
      Display cards sorted by earliest start date
    - Rank
      Display in teh sequence coming from the task database
- Task Types:
    For better high-level oveview it is possible to show level 1 and level 2 tasks alone or together. It is a great way
    to reduce what is being looked at while drilling down into balancing scenarios.
    - Features
    - Epics
- Task States
  Filter the tasks based on their state.

### Plans
The Plans section display all configured plans. The section is divided into both delivery plans and team plans
All plans are in terms of Azure DevOps just area paths, so distinguising between project and team is a configuration in the PlannerTool
You can select and deselect any set of tasks here which are then filtered in the main task board.

The little number pills display the sum of Epic and Fatures on each of these.

### Allocations
The Allocations section lists all teams on which work can be allocated.  This section also allows selecting and deselecting individual teams
to filter which tasks with these teams are shown.  The number pills display the number of Epics and tasks any single team is participating on.

### Scenarios
The Scenarios section lists all scenarios you have created.  Using the menu on the baseline scenario, which is the 'live' view from Azure DevOps,
you can make a copy and then make changes to try out different scenarios. You can make as many scenarios as you like.
If autosave is not setin the configuration modal, remember to save the scenario before closing the browser.
You can also save changes back to Azure DevOps. In this situation a modal comes up with all scenarip changes which lets you decide which items to
update.

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

  [PlannerTool Team Capacity]
  <name>: <percent_capacity_consumed>
  ...
  [/PlannerTool Team Capacity]

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