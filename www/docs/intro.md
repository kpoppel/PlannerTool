# PlannerTool Introduction

Welcome to PlannerTool.
This is a tool developed by Kim Poulsen starting 2025 to work around planning shortcomings in Azure Devops and eliminating Excel as a planning tool. The tool is context specific in that it specifically addresses a need to balance task load on a number of development teams across projects and features.  The tool is however not dependent on having balancing data to be useful. Specifying projects alone will give a graphically pleasing way to see flow of work including their dependencies if specified.

![Splash](img/intro_splash.png)

# Features
The tool has several useful features:

- Ability to create and save scenarios for experimentation and review
- Ability to create and save favorite views for plans, teams and filters
- Ability to drill down to selected projects and teams using powerful dimensional filtering
- Ability to interpret team capacity allocations from loaded tasks from Azure
- Different modes to show cards and details
- Grouping of tasks with virtual nested groups not consuming tasks as buckets
- A graph area to quickly determine team allocation and organisational allocation surplus or deficit.
- Ability to write adjusted dates to back Azure
- Serverside configuration of projects and teams with an admin frontend interface

The tool is opinionated in how it works, and may not be a fit for all organisations. Check out the [Best Practices](best_practices.md) for explanations and guidance on states, hierarchy, area-path conventions and more.


For detailed, topic-specific instructions see the manual pages in this Help index:

- Sidebar (filters & options): [Sidebar (Filters & Options)](sidebar.md)
- Timeline & Board: [Timeline & Board](timeline.md)
- Details panel and editing: [Details Panel](details.md)
- Scenarios & saving: [Scenarios & Saving](scenarios.md)
- Configuration and PAT setup: [Configuration](configuration.md)
- Review modal: [Review Modal (Save to Azure)](review_modal.md)

The sections above cover how to prepare datasets, adjust allocations, and save or push changes. For advanced topics, see the Best Practices page.
![alt text](image.png)