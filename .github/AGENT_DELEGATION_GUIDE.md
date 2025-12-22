# Agent Delegation Guide - VS Code + GitHub Copilot

**Project:** PlannerTool Architecture Transformation  
**Tool:** GitHub Copilot in VS Code  
**Date:** December 19, 2025

---

## 🎯 Quick Start

### Prerequisites
1. VS Code with GitHub Copilot extension installed
2. Copilot Chat enabled
3. Project open in VS Code workspace

### Execution Steps

```bash
# 1. Create working branch
git checkout -b architecture-transformation

# 2. Create phases directory
mkdir -p docs/phases

# 3. Copy delegation files to workspace
# (Already in .github/copilot-instructions/)
```

---

## 📋 How to Use Copilot for Each Phase

### Method 1: Copilot Chat with Context Files

**Step 1: Open Copilot Chat** (`Ctrl+Shift+I` or `Cmd+Shift+I`)

**Step 2: Load Phase Instructions**
```
@workspace I want to implement Phase 0 of the architecture transformation.

Context files:
- .github/copilot-instructions/PHASE_0_INSTRUCTIONS.md
- AGENT_ARCHITECTURE_2.md (Phase 0 section)
- AGENT_PHASE_0_GUIDE.md

Please review these files and confirm you understand the task.
```

**Step 3: Start TDD Workflow**
```
Let's follow TDD. First, create the test infrastructure files listed in Phase 0.

Start with: Create web-test-runner.config.mjs
```

**Step 4: Iterate Through Checklist**
```
✅ Created web-test-runner.config.mjs
Next: Create tests/helpers/fixtures.js

Generate the fixtures.js file with mock data generators for:
- Project, Team, Feature, Scenario
```

**Step 5: Verify Completion**
```
Review the Phase 0 completion checklist in .github/copilot-instructions/PHASE_0_INSTRUCTIONS.md

Have we completed all items?
```

---

### Method 2: Using Copilot with .copilot.yml (Recommended)

**Step 1: Activate Phase Context**

Create `.copilot-phase.yml` in project root:

```yaml
# Active Phase Configuration
current_phase: 0
phase_guide: .github/copilot-instructions/PHASE_0_INSTRUCTIONS.md
architecture_doc: AGENT_ARCHITECTURE_2.md
acceptance_criteria:
  - Test runner configured
  - 10 baseline tests passing
  - Application unchanged
```

**Step 2: Use in Copilot Chat**
```
@workspace Following .copilot-phase.yml, implement the current phase.

Start with test infrastructure setup.
```

---

### Method 3: File-by-File with Inline Comments

**Step 1: Create File Stub**
```javascript
// File: web-test-runner.config.mjs
// Phase: 0 - Test Infrastructure
// TODO: Configure test runner for:
// - Playwright launcher (chromium)
// - Coverage thresholds (80%)
// - Test file patterns (tests/**/*.test.js)

// @copilot Generate configuration following PHASE_0_INSTRUCTIONS.md
```

**Step 2: Trigger Copilot**
- Position cursor after TODO
- Press `Ctrl+I` (inline chat)
- Type: "Generate this configuration"

**Step 3: Review & Accept**
- Review generated code
- Compare with phase instructions
- Accept if correct

---

## 🔄 Phase-by-Phase Workflow

### Phase 0: Test Infrastructure

**Copilot Prompt:**
```
@workspace Phase 0: Test Infrastructure Setup

Task: Set up automated testing without changing application code.

Files to create:
1. web-test-runner.config.mjs
2. tests/helpers/fixtures.js
3. tests/helpers/testUtils.js
4. tests/helpers/legacyOracle.js
5. tests/baseline/test-event-bus-behavior.test.js
6. tests/baseline/test-state-behavior.test.js
7. tests/baseline/test-data-service-behavior.test.js

Reference: .github/copilot-instructions/PHASE_0_INSTRUCTIONS.md

Start with web-test-runner.config.mjs
```

**Verification:**
```bash
npm test  # Should pass 10 baseline tests
```

---

### Phase 1: Enhanced EventBus

**Copilot Prompt:**
```
@workspace Phase 1: Enhanced EventBus with Adapter

Context:
- Phase 0 complete (tests working)
- Reference: .github/copilot-instructions/PHASE_1_INSTRUCTIONS.md
- Guide: AGENT_PHASE_1_GUIDE.md

Task: Enhance www/js/eventBus.js with:
1. Typed event support (Symbol-based)
2. Wildcard listeners (e.g., 'feature:*')
3. Event type mapping adapter
4. Backward compatibility with string events

TDD Workflow:
Step 1: Create tests/core/test-enhanced-event-bus.test.js (tests should FAIL)
Step 2: Create www/js/core/EventRegistry.js
Step 3: Enhance www/js/eventBus.js
Step 4: Run tests (should PASS)

Start with: Create failing tests in test-enhanced-event-bus.test.js
```

**Verification:**
```bash
npm test tests/core/test-enhanced-event-bus.test.js  # Should pass 15 tests
npm test  # All 25 tests should pass
```

---

### Phase 2: DI Container

**Copilot Prompt:**
```
@workspace Phase 2: Dependency Injection Container

Context:
- Phases 0-1 complete
- Reference: .github/copilot-instructions/PHASE_2_INSTRUCTIONS.md

Task: Create DI container that wraps existing singletons

Files to create:
1. tests/core/test-di-container.test.js (RED - failing tests)
2. www/js/core/di/Container.js (GREEN - implementation)
3. www/js/core/di/ServiceRegistry.js (registers existing services)

TDD: Start with failing tests showing desired API:
- container.registerSingleton(name, factory, deps)
- container.resolve(name)
- Circular dependency detection

Start with: Create test-di-container.test.js
```

**Verification:**
```bash
npm test tests/core/test-di-container.test.js  # 20 tests pass
npm test  # All 45 tests pass
```

---

### Phase 3: Extract Scenario Services

**Copilot Prompt:**
```
@workspace Phase 3: Extract ScenarioManager from state.js

⚠️ CRITICAL PHASE: This begins state.js decomposition

Context:
- Phases 0-2 complete
- Reference: .github/copilot-instructions/PHASE_3_INSTRUCTIONS.md
- Detailed guide: AGENT_PHASE_3_GUIDE.md

Task: Extract scenario logic from state.js into ScenarioManager service

Step 1: Create Oracle Tests (document current behavior)
File: tests/domain/services/test-scenario-manager-oracle.test.js
- Capture exact behavior of state.createScenario()
- Capture exact behavior of state.activateScenario()
- Capture exact behavior of state.deleteScenario()
- All tests should PASS (documenting current system)

Step 2: Create Service Tests (test new implementation)
File: tests/domain/services/test-scenario-manager.test.js
- Mirror oracle tests but for ScenarioManager class
- Tests should FAIL initially

Step 3: Implement ScenarioManager
File: www/js/domain/services/ScenarioManager.js
- Extract scenario methods from state.js
- Use EventBus for events
- Match exact behavior from oracle tests

Step 4: Add Delegation to state.js
- Add USE_SCENARIO_SERVICE feature flag check
- Delegate to ScenarioManager when flag enabled
- Keep legacy implementation for comparison

Start with: Create oracle tests that document state.js behavior
```

**Verification:**
```bash
# With flag OFF (legacy)
npm test  # All tests pass

# With flag ON (service)
# Edit www/js/config.js: USE_SCENARIO_SERVICE = true
npm test  # All tests pass

# Manual testing
uvicorn planner:app --reload
# Test scenarios with both flag states
```

---

### Phases 4-12: Similar Pattern

Each phase follows same structure:
1. Load phase instructions
2. Create oracle/baseline tests (if extracting)
3. Create new implementation tests (RED)
4. Implement new code (GREEN)
5. Add feature flag delegation
6. Verify both implementations work
7. Manual testing
8. Complete handoff checklist

---

## 🎨 Copilot Tips & Tricks

### Tip 1: Use @workspace for Context
```
@workspace Search for all scenario-related methods in state.js

Show me the methods I need to extract for Phase 3.
```

### Tip 2: Reference Multiple Files
```
@workspace Compare:
- www/js/state.js (current implementation)
- .github/copilot-instructions/PHASE_3_INSTRUCTIONS.md (target)

Generate ScenarioManager that matches state.js behavior exactly.
```

### Tip 3: Generate Test + Implementation Together
```
@workspace Following TDD for Phase 1:

1. Generate test-enhanced-event-bus.test.js with 15 tests
2. Show me what the enhanced eventBus.js should look like
3. Generate EventRegistry.js with typed constants

Use AGENT_PHASE_1_GUIDE.md as reference.
```

### Tip 4: Iterative Refinement
```
@workspace Review tests/core/test-enhanced-event-bus.test.js

Are these tests following the pattern in AGENT_PHASE_1_GUIDE.md?
What's missing?
```

### Tip 5: Verify Feature Flag Logic
```
@workspace In www/js/state.js, show me how to add delegation pattern for scenario methods.

Pattern:
- Check featureFlags.USE_SCENARIO_SERVICE
- If true: delegate to this._getScenarioManager()
- If false: keep existing implementation

Generate the modified createScenario() method.
```

### Tip 6: Generate Handoff Checklist
```
@workspace I've completed Phase 3. Generate the handoff checklist.

Include:
- Files changed
- Tests passing
- Feature flag status
- Manual verification steps
- Known issues

Format: Markdown for docs/phases/PHASE_3_HANDOFF.md
```

---

## 📝 Documentation Generation

### After Each Phase:

**Copilot Prompt:**
```
@workspace Phase [N] is complete. Generate documentation:

1. PHASE_[N]_HANDOFF.md with:
   - Checklist completion status
   - Files created/modified
   - Key decisions made
   - Integration points
   - Known issues

2. Update ARCHITECTURE.md:
   - Document new abstractions
   - Update layer diagrams
   - Add API examples

3. Create PHASE_[N]_CONTEXT.md:
   - What changed
   - Why we made these choices
   - What next phase needs to know

Reference completed phase instructions for context.
```

---

## 🔍 Debugging with Copilot

### When Tests Fail:

```
@workspace Tests are failing in tests/domain/services/test-scenario-manager.test.js

Error: [paste error message]

Context:
- Phase 3: ScenarioManager implementation
- Reference: AGENT_PHASE_3_GUIDE.md

Analyze the error and suggest fixes.
```

### When Application Breaks:

```
@workspace Application not working after Phase [N] changes.

Console errors: [paste errors]

Files modified:
- [list files]

Feature flag: USE_[FEATURE] = true

Reference: .github/copilot-instructions/PHASE_[N]_INSTRUCTIONS.md

What went wrong? How to fix?
```

### When Behavior Doesn't Match:

```
@workspace Comparing legacy vs new implementation:

Legacy (state.js):
- createScenario() generates ID: scen_[timestamp]_[random]

New (ScenarioManager):
- createScenario() generates ID: scenario_[timestamp]

These should match exactly. Fix ScenarioManager to match legacy format.
```

---

## 🚀 Advanced: Parallel Phases

### When Phases Are Independent:

**Terminal 1: Phase 4 (Filter Services)**
```
git checkout -b phase-4-filter-manager
# Work on Phase 4 with Copilot
```

**Terminal 2: Phase 5 (Capacity Services)**
```
git checkout -b phase-5-capacity-calculator
# Work on Phase 5 with Copilot
```

**Both can work simultaneously because:**
- Phase 4: Extracts filter logic
- Phase 5: Extracts capacity logic
- No overlapping code changes

**Merge Strategy:**
```bash
# Merge Phase 4
git checkout architecture-transformation
git merge phase-4-filter-manager
npm test  # Verify

# Merge Phase 5
git merge phase-5-capacity-calculator
npm test  # Verify

# Resolve conflicts if any (Copilot can help)
```

---

## 📊 Progress Tracking

### Create Progress Dashboard:

**File: docs/PROGRESS.md**

```markdown
# Architecture Transformation Progress

## Phase Status

- [x] Phase 0: Test Infrastructure (10 tests, Dec 19)
- [x] Phase 1: Enhanced EventBus (15 tests, Dec 20)
- [x] Phase 2: DI Container (20 tests, Dec 21)
- [ ] Phase 3: Scenario Services (25 tests, In Progress)
- [ ] Phase 4: Filter Services (20 tests, Not Started)
...

## Test Count: 45 / 350 (12.8%)
## Code Coverage: 85%
## Feature Flags Active: 2
```

**Copilot Prompt:**
```
@workspace Update docs/PROGRESS.md after completing Phase [N].

Mark phase as complete, update test count, add completion date.
```

---

## 🎯 Success Criteria Per Phase

After each phase, verify:

```
@workspace Verify Phase [N] completion:

Run through this checklist:
1. All new tests passing?
2. All existing tests passing?
3. Feature flag works (ON/OFF)?
4. No console errors?
5. Manual test checklist complete?
6. Documentation updated?

Generate verification report.
```

---

## 📚 Context Files for Copilot

Copilot has access to these files automatically:
- `.github/copilot-instructions/*.md` (phase instructions)
- `AGENT_ARCHITECTURE_2.md` (main plan)
- `AGENT_PHASE_*_GUIDE.md` (detailed guides)
- `AGENT_QUICK_REFERENCE.md` (cheat sheet)
- All existing code in `www/js/`

---

## 🔗 Example Complete Session

### Full Phase 0 Execution:

```
You: @workspace Let's implement Phase 0 from AGENT_ARCHITECTURE_2.md

Copilot: I'll help you set up the test infrastructure. First, let's create web-test-runner.config.mjs...

You: [Review generated config] Looks good. Next file?

Copilot: Creating tests/helpers/fixtures.js with mock data generators...

You: [Review] Perfect. Continue with testUtils.js

Copilot: [Generates testUtils.js]

You: Now create baseline tests for EventBus

Copilot: [Generates tests/baseline/test-event-bus-behavior.test.js]

You: Run npm test - do the tests pass?

Copilot: Let me check the test output... [analyzes]

You: All 10 tests passing. Create Phase 0 handoff document.

Copilot: [Generates docs/phases/PHASE_0_HANDOFF.md]

You: Phase 0 complete. Moving to Phase 1.
```

---

## 🎬 Getting Started Now

**Step 1: Preparation**
```bash
cd /home/kpo/development/PlannerTool
git checkout -b architecture-transformation
mkdir -p docs/phases
```

**Step 2: Open VS Code**
```bash
code .
```

**Step 3: Open Copilot Chat** (`Ctrl+Shift+I`)

**Step 4: Start Phase 0**
```
@workspace I'm starting the PlannerTool architecture transformation.

Context:
- Main plan: AGENT_ARCHITECTURE_2.md
- Phase guide: AGENT_PHASE_0_GUIDE.md
- Instructions: .github/copilot-instructions/PHASE_0_INSTRUCTIONS.md

Task: Implement Phase 0 - Test Infrastructure Setup

Let's start with creating web-test-runner.config.mjs
```

**You're ready to go! 🚀**
