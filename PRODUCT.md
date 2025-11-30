# Product Overview

## Purpose
This product provides a unified, extensible platform for planning and managing Azure DevOps work items, projects, and teams, with a focus on usability, modularity, and offline capability. It is designed for organizations and teams seeking a streamlined, customizable interface for DevOps planning and workload visualization.

## Key Features

### 1. Azure DevOps Integration
- **Authentication:** Secure SSO and PAT-based access to Azure DevOps.
- **Project & Team Management:** Automatically discovers and organizes area paths as projects and teams, allowing users to select, filter, and color-code them for clarity.
- **Work Item Retrieval:** Fetches and displays work items (Features, Epics, etc.) with essential details (title, type, state, dates, description, links).

### 2. Interactive Planning UI
- **Sidebar:** Fixed-width panel for project/team selection, filtering, and color assignment. Always visible for quick access.
- **Timeline & Load Graph:** Visualizes organizational and team workload over time, with adjustable resolution (weeks, months, years). Stacked step diagram aligns with feature cards and timeline.
- **Feature Cards:** Drag-and-drop cards represent work items, showing team loads, project color, and sync status. Cards can be moved to simulate planning scenarios, updating backend data and UI color cues.
- **Details Panel:** Collapsible panel displays full work item details and links to Azure DevOps.
- **Responsive & Scrollable:** Main area supports horizontal/vertical scrolling and dynamic timeline scaling.

### 3. Offline & Development Modes
- **Offline Access:** Caches work items in `work_items.json` for use when API access is unavailable or in development mode.
- **Development Mode:** Enables test endpoints, cached data, and JavaScript unit test page for rapid prototyping and testing.

### 4. Extensible Web Service
- **API Endpoints:** RESTful endpoints for configuration, area paths, work items, and test/debug data. Easily extended for new features.
- **Frontend-Backend Communication:** Uses HTTP requests (fetch/AJAX) for seamless data exchange.

### 5. Automated Testing
- **Python Tests:** Each backend module has its own test file in the `tests` directory, using the standard unittest framework.
- **JavaScript Tests:** Served via a dedicated test page for frontend code.

## User Scenarios
- **Project Managers:** Visualize and balance team workloads, simulate planning scenarios, and access detailed work item data.
- **Developers:** Track features, update timelines, and use offline mode during travel or outages.
- **Teams:** Customize project/team views, filter and color-code elements, and extend UI for specific workflows.

## Benefits
- **Efficiency:** Reduces manual navigation and improves planning productivity.
- **Customizability:** Modular design allows users to tailor configuration, UI, and API endpoints.
- **Reliability:** Offline mode ensures uninterrupted access to planning data.
- **Extensibility:** Easily add new features, endpoints, or UI components.
- **Testability:** Automated tests maintain product quality and support safe evolution.

## Future Directions
- Add authentication and user management for web service endpoints.
- Enable editing and creation of work items from the frontend.
- Integrate notifications and real-time updates.
- Expand support for additional DevOps entities (iterations, teams, tags).

---
This product empowers organizations to plan, visualize, and manage Azure DevOps projects with flexibility, reliability, and ease, supporting both current needs and future growth.
