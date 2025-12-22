# How to Execute the Transformation with GitHub Copilot

This guide shows you **exactly how** to use GitHub Copilot to execute the 12-phase PlannerTool transformation.

---

## Prerequisites

✅ VS Code with GitHub Copilot extension installed  
✅ Python environment with `uvicorn` installed  
✅ Node.js and npm installed (for test runner)  
✅ PlannerTool repository cloned

---

## Quick Start (5 Steps)

### 1. Open the Project in VS Code

```bash
cd /home/kpo/development/PlannerTool
code .
```

### 2. Tell Copilot What Phase You're On

Open `.copilot-phase.yml` and uncomment Phase 0:

```yaml
# Phase 0: Test Infrastructure Setup
active_phase: PHASE_0
guide: .github/copilot-instructions/PHASE_0_INSTRUCTIONS.md
```

Save the file.

### 3. Open Copilot Chat

- **Keyboard shortcut:** `Ctrl+Alt+I` (Linux/Windows) or `Cmd+Alt+I` (Mac)
- **OR** Click the Copilot icon in the sidebar

### 4. Ask Copilot to Start

Type in Copilot Chat:

```
I'm ready to start Phase 0. Show me the first file to create.
```

Copilot will reference `.copilot-phase.yml` and `.github/copilot-instructions/PHASE_0_INSTRUCTIONS.md` to guide you.

### 5. Follow Copilot's Instructions

Copilot will show you code templates. Copy them into new files, run tests, and iterate.

---

## Detailed Workflow (Phase 0 Example)

### Step 1: Ask for Overview

**You:**
```
What's the objective of Phase 0?
```

**Copilot will respond:**
```
Phase 0 sets up test infrastructure:
- Install Web Test Runner
- Create test helpers
- Write baseline tests
Duration: 1 day
```

### Step 2: Get Installation Commands

**You:**
```
Show me the installation commands for Phase 0
```

**Copilot will provide:**
```bash
npm install --save-dev \
  @web/test-runner \
  @open-wc/testing \
  chai \
  sinon
```

Run this in terminal: `Ctrl+` ` (backtick)

### Step 3: Create Test Configuration

**You:**
```
Show me the web-test-runner.config.js template
```

**Copilot will provide the code.** Create the file:
1. Right-click workspace → New File → `web-test-runner.config.js`
2. Paste Copilot's code
3. Save

### Step 4: Create Test Helpers

**You:**
```
Show me the test-helpers.js template
```

**Copilot provides code.** Create `tests/test-helpers.js` and paste.

### Step 5: Write First Test

**You:**
```
Show me the baseline test template
```

**Copilot provides test code.** Create `tests/baseline/test-baseline.test.js` and paste.

### Step 6: Run Tests

**You:**
```
How do I run the tests?
```

**Copilot:**
```bash
npm test
```

Run in terminal. You should see:
```
✓ EventBus exists
✓ state exists
...
10 tests passed
```

### Step 7: Verify Phase Complete

**You:**
```
How do I verify Phase 0 is complete?
```

**Copilot provides checklist:**
- [ ] All 10 baseline tests pass
- [ ] No console errors
- [ ] Coverage report generated

Check each item. If all pass, Phase 0 is done!

### Step 8: Move to Phase 1

Update `.copilot-phase.yml`:
```yaml
# Phase 0: Test Infrastructure Setup
# active_phase: PHASE_0  ← Comment out

# Phase 1: Enhanced EventBus
active_phase: PHASE_1  ← Uncomment
```

Save. Now ask:
```
I'm ready to start Phase 1. What should I do first?
```

---

## Copilot Commands Cheat Sheet

### Getting Started
- `"What's the objective of [current phase]?"`
- `"Show me the first file to create"`
- `"What are the deliverables for this phase?"`

### Writing Code
- `"Show me the template for [filename]"`
- `"Generate tests for [feature]"`
- `"How do I implement [specific method]?"`

### Testing
- `"Show me how to test [feature]"`
- `"What's the expected test output?"`
- `"Why is [test] failing?"`

### Verification
- `"How do I verify this phase is complete?"`
- `"What's the acceptance criteria?"`
- `"Show me the manual testing steps"`

### Debugging
- `"I'm getting error: [error message]. How do I fix it?"`
- `"Why isn't [feature] working?"`
- `"Show me common issues for this phase"`

### Moving Forward
- `"What's the next step?"`
- `"Can I move to the next phase?"`
- `"What depends on this phase?"`

---

## Using Copilot's Inline Suggestions

While writing code, Copilot will suggest completions in **gray text**.

**Accept suggestion:** Press `Tab`  
**Reject suggestion:** Press `Esc` or keep typing  
**Next suggestion:** `Alt+]` or `Option+]`  
**Previous suggestion:** `Alt+[` or `Option+[`

**Example:**
```javascript
// You type:
export class ScenarioManager {
  constructor(

// Copilot suggests (gray text):
  constructor(eventBus) {
    this.bus = eventBus;
    this.scenarios = new Map();
  }

// Press Tab to accept
```

---

## Using Copilot Edits

Copilot can edit existing files directly.

1. Open file you want to edit
2. Select code to modify
3. Open Copilot Chat
4. Ask: `"Refactor this to use dependency injection"`
5. Copilot will show diff
6. Click **Apply** to accept changes

---

## Tips for Effective Copilot Use

### ✅ DO:
- **Be specific:** "Create ScenarioManager.js with constructor injection" is better than "make a service"
- **Reference files:** "Update state.js to delegate to ScenarioManager"
- **Ask for tests first:** "Show me tests for activateScenario method"
- **Request templates:** "Show me the oracle test template"
- **Ask about verification:** "How do I test both feature flag paths?"

### ❌ DON'T:
- Ask vague questions: "How do I code this?"
- Skip test writing
- Ignore feature flags
- Move to next phase without verification
- Accept suggestions without reviewing

---

## Phase-by-Phase Workflow

### For Phases with Detailed Guides (0-3)

1. Open `.copilot-phase.yml` → Set `active_phase`
2. Ask: `"Show me the phase overview"`
3. Follow TDD workflow:
   - Ask for test template
   - Write failing tests (RED)
   - Ask for implementation template
   - Implement code (GREEN)
   - Run tests
   - Refactor
4. Verify acceptance criteria
5. Manual testing
6. Move to next phase

### For Phases with Quick Reference (4-12)

1. Open `.copilot-phase.yml` → Set `active_phase`
2. Ask: `"What pattern does this phase follow?"`
3. If pattern is "Oracle + Service + Delegation":
   - Reference Phase 3 as template
   - Ask: `"Show me oracle tests for [feature]"`
   - Follow same workflow as Phase 3
4. If new pattern (e.g., Lit components):
   - Ask: `"Show me example Lit component"`
   - Reference PHASES_4-12_QUICK_REFERENCE.md

---

## Debugging with Copilot

### Test Failures

**You:**
```
npm test shows:
✗ activateScenario emits event
Expected undefined to equal 's1'

How do I fix this?
```

**Copilot will analyze and suggest:**
```javascript
// You might be missing:
bus.emit('scenario:activated', { scenarioId });
```

### Runtime Errors

Open browser console, copy error:

**You:**
```
I'm getting:
TypeError: Cannot read property 'get' of undefined
  at state.activateScenario (state.js:45)

What's wrong?
```

**Copilot will suggest:**
```
Check that this.scenarios is initialized in constructor.
```

### Feature Flag Issues

**You:**
```
Feature flag USE_SCENARIO_SERVICE is true but legacy code is running. Why?
```

**Copilot will check:**
```
1. Is config.js imported correctly?
2. Is featureFlags object exported?
3. Is the if-statement checking the right flag?
```

---

## Example Complete Session (Phase 3)

```
[You uncomment active_phase: PHASE_3 in .copilot-phase.yml]

You: "I'm ready to start Phase 3. What's the first step?"

Copilot: "Phase 3 extracts ScenarioManager from state.js. First step:
Write oracle tests to capture current state.js behavior.
Create tests/services/test-scenario-oracle.test.js"

You: "Show me the oracle test template"

Copilot: [provides full test code with 10 test cases]

You: [Creates file, pastes code]

You: "How do I run just these tests?"

Copilot: "npm test tests/services/test-scenario-oracle.test.js"

You: [Runs tests - all pass]

You: "What's next?"

Copilot: "Now write ScenarioManager service tests.
Create tests/services/test-scenario-manager.test.js"

You: "Show me the service test template"

Copilot: [provides test code]

You: [Creates file, pastes code, runs tests - they FAIL (RED)]

You: "Tests are failing. Show me ScenarioManager.js implementation"

Copilot: [provides ScenarioManager class]

You: [Creates www/js/services/ScenarioManager.js, pastes code]

You: [Runs tests - all pass (GREEN)]

You: "Now what?"

Copilot: "Add delegation to state.js. Import ScenarioManager and
add if (featureFlags.USE_SCENARIO_SERVICE) checks."

You: "Show me the delegation pattern"

Copilot: [provides code diff for state.js]

You: [Applies changes to state.js]

You: "How do I test both code paths?"

Copilot: "1. Set USE_SCENARIO_SERVICE: false, run app
2. Set USE_SCENARIO_SERVICE: true, run app
Both should work identically"

You: [Tests with flag OFF - works]
You: [Tests with flag ON - works]

You: "How do I verify Phase 3 is complete?"

Copilot: [shows acceptance criteria checklist]

You: [Checks all items - all pass]

You: "Phase 3 is done. What's next?"

Copilot: "Update .copilot-phase.yml to active_phase: PHASE_4.
Phase 4 extracts FilterManager using the same pattern as Phase 3."

You: [Updates .copilot-phase.yml, moves to Phase 4]
```

---

## Parallel Execution (Advanced)

Once comfortable with the workflow, you can work on multiple phases simultaneously by opening multiple VS Code windows.

**Window 1:** Tests for Phase 4  
**Window 2:** Implementation for Phase 3  
**Window 3:** Documentation for Phase 2  

Each window can have its own Copilot Chat context.

**Not recommended for beginners** - stick to sequential execution first.

---

## Progress Tracking

### Create a Progress File

Create `PROGRESS.md` in workspace:

```markdown
# Transformation Progress

## Phase 0: Test Infrastructure ✅
- Completed: 2024-01-15
- Tests: 10/10 passing
- Notes: All baseline tests pass

## Phase 1: Enhanced EventBus 🔄
- Started: 2024-01-16
- Status: Writing tests
- Next: Implement EventRegistry

## Phase 2: DI Container ⏳
- Not started

...
```

Update after each phase. Copilot can read this for context.

---

## Common Mistakes to Avoid

1. **Skipping tests** → Always write tests BEFORE implementation
2. **Ignoring feature flags** → Test both ON and OFF paths
3. **Not committing** → Commit after each phase completes
4. **Moving too fast** → Verify each phase before proceeding
5. **Accepting all suggestions** → Review Copilot's code carefully
6. **Vague questions** → Be specific about what you need

---

## Getting Help

### From Copilot
Ask: `"I'm stuck on [issue]. What should I check?"`

### From Documentation
- Phase details: `.github/copilot-instructions/PHASE_X_INSTRUCTIONS.md`
- Quick reference: `AGENT_QUICK_REFERENCE.md`
- Architecture: `AGENT_ARCHITECTURE_2.md`

### From Tests
Run tests to see what's failing:
```bash
npm test -- --reporter=verbose
```

---

## Success Metrics

After each phase, verify:
- ✅ All tests pass
- ✅ Application runs without errors
- ✅ Feature flags toggle correctly
- ✅ Manual testing confirms functionality
- ✅ Code committed to git

---

## Ready to Start?

1. Open `.copilot-phase.yml`
2. Uncomment `active_phase: PHASE_0`
3. Open Copilot Chat (`Ctrl+Alt+I`)
4. Ask: **"I'm ready to start Phase 0. Show me the first step."**

Let's transform this codebase! 🚀
