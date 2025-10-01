# Claude Command Orchestration System Generator

You are tasked with analyzing a codebase and setting up an orchestrated agent system where a main orchestrator delegates work to specialized sub-agents for different code slices. The system uses ONLY CLAUDE.md files in slice folders - no separate context files.

## Phase 1: Initial Analysis & Slice Discovery/Creation

<ultrathink>
Analyze what exists and determine what needs to be created:

1. **Document Analysis**:
   - Check for PRD.md or similar product requirements document
   - Check for architecture.md, ARCHITECTURE.md, or design documents
   - Check for README.md or other documentation
   - Extract project type, tech stack, and intended structure from docs
   - Ignore any dot-prefixed folder (like .claude)

2. **Folder Structure Decision**:
   ```
   IF (no code folders exist):
     - Parse PRD/architecture docs for intended structure
     - Determine project type from requirements
     - CREATE complete folder structure based on project type
   ELSE IF (partial structure exists):
     - Identify existing folders
     - Determine missing slices
     - CREATE missing folders to complete 7 slices
   ELSE:
     - Use existing folder structure
     - Identify best 7 slices from what exists
   ```

3. **Slice Creation Strategy** - Create exactly 7 key application slices:
   
   **For React/Next.js Projects** (from PRD):
   ```
   src/
   ├── components/     # UI components
   ├── hooks/          # Custom React hooks
   ├── services/       # API and external services
   ├── store/          # State management
   ├── utils/          # Helper functions
   ├── styles/         # Global styles/themes
   └── pages/          # Routes/pages
   ```
   
   **For Node.js/Express Projects** (from PRD):
   ```
   src/
   ├── controllers/    # Request handlers
   ├── models/         # Data models
   ├── services/       # Business logic
   ├── middleware/     # Express middleware
   ├── routes/         # API routes
   ├── utils/          # Utilities
   └── validators/     # Input validation
   ```
   
   **For Python/Django Projects** (from PRD):
   ```
   src/
   ├── models/         # Database models
   ├── views/          # View controllers
   ├── serializers/    # Data serialization
   ├── services/       # Business logic
   ├── utils/          # Helper functions
   ├── api/            # API endpoints
   └── managers/       # Model managers
   ```
   
   **For Full-Stack Projects** (from PRD):
   ```
   ├── frontend/       # Client application
   ├── backend/        # Server application
   ├── shared/         # Shared code/types
   ├── database/       # DB schemas/migrations
   ├── api/            # API contracts
   ├── scripts/        # Build/deploy scripts
   └── infrastructure/ # IaC/config files
   ```

4. **Architecture-Driven Structure**:
   - If architecture doc specifies microservices → create service folders
   - If architecture doc specifies layers → create layer folders
   - If architecture doc specifies modules → create module folders
   - Always respect documented architecture over generic patterns

5. **The 8th slice is ALWAYS**:
   ```
   context/            # Minimal global context
   ```
</ultrathink>

## Phase 2: Folder Creation & Structure Setup

### When Creating New Folders:

```markdown
# Folder Creation Protocol

## Create Complete Structure
When starting from PRD/documentation only:

1. **Parse Requirements**:
   - Extract: project type, features, tech stack
   - Identify: architectural patterns mentioned
   - Determine: appropriate folder structure

2. **Create Folders**:
   ```bash
   # Create all 8 slice folders
   mkdir -p src/components
   mkdir -p src/services
   mkdir -p src/hooks
   mkdir -p src/store
   mkdir -p src/utils
   mkdir -p src/api
   mkdir -p src/styles
   mkdir -p context
   ```

3. **Add Initial Files**:
   For each created folder, add:
   - CLAUDE.md (sub-agent configuration)
   - .gitkeep (to preserve empty folders)
   - index.ts/index.js/index.py (based on language)

4. **Create Supporting Structure**:
   ```bash
   # Common supporting folders (not slices)
   mkdir -p public
   mkdir -p tests
   mkdir -p docs
   mkdir -p config
   mkdir -p .claude
   ```
```

### Folder Creation Based on Architecture Document:

If an architecture document exists, override default structure:

```yaml
Architecture Types:
  microservices:
    - services/auth/
    - services/users/
    - services/payments/
    - services/notifications/
    - shared/contracts/
    - shared/utils/
    - infrastructure/

  hexagonal:
    - domain/
    - application/
    - infrastructure/
    - presentation/
    - ports/
    - adapters/
    - shared/

  clean_architecture:
    - entities/
    - usecases/
    - controllers/
    - presenters/
    - gateways/
    - frameworks/
    - drivers/

  modular_monolith:
    - modules/auth/
    - modules/catalog/
    - modules/orders/
    - modules/shipping/
    - shared/kernel/
    - shared/infrastructure/
    - api/gateway/
```

## Phase 3: Generate Orchestration Structure

### Main CLAUDE.md (Project Root)

Generate the main orchestrator file at project root:

```markdown
# Main Orchestrator Agent

## CRITICAL: Orchestration Mode
**THIS AGENT NEVER DIRECTLY EDITS CODE. IT ONLY ORCHESTRATES SUB-AGENTS.**

## System Overview
- Project Type: [DETECTED: React/Node.js/Python/etc.]
- PRD Available: [YES/NO - path: PRD.md if found]
- Architecture: [DETECTED PATTERN]
- Generated: [DATE]
- Last Updated: [DATE]

## Slice Architecture

### Application Slices (7)
1. `[slice1-path]/` - [Purpose] - Agent: `[slice1-path]/CLAUDE.md`
2. `[slice2-path]/` - [Purpose] - Agent: `[slice2-path]/CLAUDE.md`
3. `[slice3-path]/` - [Purpose] - Agent: `[slice3-path]/CLAUDE.md`
4. `[slice4-path]/` - [Purpose] - Agent: `[slice4-path]/CLAUDE.md`
5. `[slice5-path]/` - [Purpose] - Agent: `[slice5-path]/CLAUDE.md`
6. `[slice6-path]/` - [Purpose] - Agent: `[slice6-path]/CLAUDE.md`
7. `[slice7-path]/` - [Purpose] - Agent: `[slice7-path]/CLAUDE.md`

### Global Context Slice (1)
8. `context/` - Global patterns and standards - Agent: `context/CLAUDE.md`

## Orchestration Protocol

### For EVERY User Request:

1. **Request Analysis**:
   ```
   ANALYZE request to determine:
   - Which slices are affected
   - What operations are needed
   - Dependencies between slices
   - Order of operations
   ```

2. **Sub-Agent Spawning**:
   ```
   FOR each affected slice:
     LOAD CLAUDE.md from slice folder
     SPAWN sub-agent with:
       - Slice-specific knowledge from CLAUDE.md
       - Specific task for this slice
       - Required outputs
       - Cross-slice dependencies
   ```

3. **Execution Modes**:
   - **Sequential**: Process slices in dependency order
   - **Parallel**: Process independent slices simultaneously
   - **Hybrid**: Parallel where possible, sequential where dependencies exist

4. **Coordination Flow**:
   ```
   Main Orchestrator:
   ├── Analyze request
   ├── Identify affected slices
   ├── Load PRD.md (if exists)
   ├── Spawn sub-agents (using slice CLAUDE.md files)
   │   ├── Sub-Agent 1: [slice1]
   │   │   └── Returns: changes/analysis
   │   ├── Sub-Agent 2: [slice2]
   │   │   └── Returns: changes/analysis
   │   └── ...
   ├── Collect results
   ├── Resolve conflicts
   ├── Integrate changes
   └── Report to user
   ```

## Sub-Agent Communication Protocol

### Request Format to Sub-Agent:
```yaml
task: [specific task description]
slice_context: [loaded from slice's CLAUDE.md]
dependencies:
  - from_slice: [other slice name]
    needs: [what information/interface]
expected_output: [what to return]
constraints: [any limitations]
```

### Response Format from Sub-Agent:
```yaml
completed: [true/false]
changes_made:
  - file: [path]
    operation: [create/update/delete]
    description: [what changed]
cross_slice_impacts:
  - slice: [affected slice]
    impact: [description]
needs_from_orchestrator:
  - [any unresolved dependencies]
context_updates:
  - [any updates needed to slice's CLAUDE.md]
```

## Decision Tree for Request Routing

```
User Request Analysis:
├── Contains "component" → Route to components slice
├── Contains "API/endpoint" → Route to api/routes slice
├── Contains "database/model" → Route to models slice
├── Contains "business logic" → Route to services/processors
├── Contains "authentication" → Route to auth + middleware slices
├── Contains "styling/UI" → Route to components + styles slices
├── Affects multiple areas → Route to all relevant slices
└── Global change → Route to context/ first, then affected slices
```

## Slice Dependency Matrix

| Slice | Depends On | Depended By |
|-------|------------|-------------|
| [slice1] | [dependencies] | [dependents] |
| [slice2] | [dependencies] | [dependents] |
| ... | ... | ... |

## Self-Maintenance Protocol

After EVERY request:
1. Check if slice boundaries have changed
2. Update affected CLAUDE.md files with new patterns
3. Update dependency matrix if relationships changed
4. Log changes in this orchestrator file

## Change History
- [DATE]: Initial system generation
- [DATE]: [Update description]
```

### Sub-Agent CLAUDE.md Template (For Each Slice)

For each slice, generate based on whether folder exists or is being created:

#### For NEWLY CREATED Folders (from PRD/Architecture):

```markdown
# Sub-Agent: [Slice Name]

## Slice Metadata
- Path: `[full-path-from-root]`
- Status: **TO BE IMPLEMENTED**
- Purpose: [from PRD/architecture doc]
- Language: [from PRD]
- Framework: [from PRD]
- Created: [DATE]

## Slice Responsibilities (From Requirements)
Based on PRD/Architecture document:
1. [Responsibility from PRD]
2. [Responsibility from PRD]
3. [Responsibility from PRD]

## Planned Structure
```
[slice-folder]/
├── [planned-subfolder1]/
│   ├── [expected-file-pattern]
│   └── [expected-file-pattern]
├── [planned-subfolder2]/
└── [planned-key-files]
```

## Expected Patterns (From Architecture Doc)
- **Naming Conventions**: [specified in docs or defaults]
  - Components: [pattern]
  - Functions: [pattern]
  - Files: [pattern]
- **Architecture Pattern**: [from architecture doc]
- **Design Patterns**: [specified patterns]

## Planned Interfaces (From PRD)
```[language]
// Expected main exports
export interface [InterfaceName] {
  // Based on PRD requirements
}
```

## Dependencies (From Architecture)
```yaml
will_depend_on: [other-slice]
reason: [from architecture doc]

will_depend_on: [other-slice]
reason: [from architecture doc]
```

## Implementation Guidelines
From PRD/Architecture:
- [Guideline 1]
- [Guideline 2]
- [Guideline 3]

## Task Execution Protocol
1. Check if implementation matches PRD requirements
2. Follow architecture document patterns
3. Create files following planned structure
4. Update this CLAUDE.md as code is added
5. Transition from "planned" to "actual" patterns

## PRD Requirements for This Slice
[Extract specific requirements from PRD that relate to this slice]
- Feature: [from PRD]
- Feature: [from PRD]
```

#### For EXISTING Folders (with code):

[Keep the existing template for folders with code]

```markdown
# Sub-Agent: [Slice Name]

## Slice Metadata
- Path: `[full-path-from-root]`
- Purpose: [what this slice handles]
- Language: [primary language]
- Framework: [if applicable]
- Last Updated: [DATE]

## Slice Responsibilities
1. [Responsibility 1]
2. [Responsibility 2]
3. [Responsibility 3]

## Self-Updating Context
This section is automatically updated after each modification to maintain current patterns.

### Current Patterns
[Extracted from code analysis of this slice]
- **Naming Conventions**: [detected naming patterns]
  - Components: [pattern with example]
  - Functions: [pattern with example]
  - Files: [pattern with example]
- **File Structure**: [detected organization]
- **Design Patterns**: [detected patterns like MVC, Factory, etc.]

### File Inventory
```
[slice-folder]/
├── [subfolder1]/
│   ├── [file-pattern]
│   └── [file-pattern]
├── [subfolder2]/
└── [key-files-list]
```

### Key Interfaces
```[language]
// Main exports from this slice
export interface [InterfaceName] {
  [discovered interface structure]
}

// Main types used
type [TypeName] = [discovered type]
```

## Cross-Slice Interfaces

### Dependencies (What This Slice Imports)
```yaml
from: [other-slice-path]
imports:
  - [module/component/function]
  - [module/component/function]
purpose: [why needed]

from: [other-slice-path]
imports:
  - [module/component/function]
purpose: [why needed]
```

### Exports (What This Slice Provides)
```yaml
exports:
  - name: [module/component/function]
    used_by: [slice1, slice2]
    type: [component/utility/service/type]
  - name: [module/component/function]
    used_by: [slice3]
    type: [component/utility/service/type]
```

## Code Standards (Discovered)

### Example Patterns from This Slice
```[language]
// Typical component/function pattern
[actual code example from this slice]

// Error handling pattern
[actual code example from this slice]

// Testing pattern
[actual code example from this slice]
```

## Task Execution Protocol

When receiving a task from orchestrator:
1. Load current state from this CLAUDE.md
2. Analyze files in this slice only
3. Apply slice-specific patterns
4. Make changes following discovered standards
5. Update this CLAUDE.md if patterns change
6. Report back to orchestrator with:
   - Changes made
   - Cross-slice impacts
   - Any CLAUDE.md updates needed

## Constraints
- **ONLY modify files within**: `[this-slice-path]/*`
- **Maintain consistency** with patterns listed above
- **Report cross-slice needs** to orchestrator - never modify other slices
- **Update this file** when patterns change
- **Follow existing code style** discovered in this slice

## Recent Changes
- [DATE]: [What changed in this slice]
- [DATE]: [What changed in this slice]
```

### Global Context CLAUDE.md (context/ folder)

```markdown
# Global Context Agent

## CRITICAL: Keep This Minimal
Only truly global, cross-cutting concerns belong here. Slice-specific patterns belong in slice CLAUDE.md files.

## Global Invariants
[Maximum 5 essential rules that apply everywhere]
1. [Critical invariant 1 - e.g., Always use TypeScript]
2. [Critical invariant 2 - e.g., All errors must be logged]
3. [Critical invariant 3 - e.g., No direct DOM manipulation]

## Technology Stack
- Runtime: [detected]
- Package Manager: [detected]
- Build Tool: [detected]
- Test Runner: [detected]
- Linter: [detected]

## Cross-Cutting Patterns
- Error Boundary Pattern: [location if exists]
- Logging Pattern: [location if exists]
- Auth Pattern: [location if exists]

## Shared Resources
- Type Definitions: `[path if exists]`
- Global Constants: `[path if exists]`
- Shared Utilities: `[path if exists]`

## When to Update This File
ONLY when truly global changes occur:
- Technology stack changes
- New cross-cutting concern added
- Global invariant changes

Last Updated: [DATE]
```

## Phase 3: Validation & Output

### Validation Checklist
1. ✓ Exactly 7 application slices identified (all are existing folders)
2. ✓ 1 context slice configured (kept minimal)
3. ✓ Main CLAUDE.md acts as orchestrator only
4. ✓ Each slice has its own CLAUDE.md file
5. ✓ NO separate context files generated (only CLAUDE.md files)
6. ✓ Dependency matrix is complete
7. ✓ Communication protocol is clear
8. ✓ PRD.md referenced if found
9. ✓ Self-updating mechanism included

## Output Format

```
=== PROJECT INITIALIZATION STATUS ===
Starting State: [DOCUMENTATION_ONLY / PARTIAL_CODE / FULL_CODE]
PRD Found: [YES/NO - path]
Architecture Doc Found: [YES/NO - path]
Folders Created: [LIST OF NEW FOLDERS or "none"]

=== FOLDER STRUCTURE CREATED/VERIFIED ===
```
project_root/
├── CLAUDE.md (orchestrator)
├── src/
│   ├── components/
│   │   └── CLAUDE.md
│   ├── services/
│   │   └── CLAUDE.md
│   ├── hooks/
│   │   └── CLAUDE.md
│   ├── store/
│   │   └── CLAUDE.md
│   ├── utils/
│   │   └── CLAUDE.md
│   ├── api/
│   │   └── CLAUDE.md
│   └── styles/
│       └── CLAUDE.md
└── context/
    └── CLAUDE.md
```

=== FILE: CLAUDE.md (root) ===
[orchestrator content]

=== FILE: [slice1-path]/CLAUDE.md ===
[slice1 agent - either from code analysis or PRD specs]

=== FILE: [slice2-path]/CLAUDE.md ===
[slice2 agent - either from code analysis or PRD specs]

[... continue for all 8 slices ...]

=== FOLDERS CREATED ===
[List any folders that were created]

=== VERIFICATION ===
✓ Folder structure exists (created if needed)
✓ All 8 slices have folders and CLAUDE.md files
✓ PRD requirements mapped to slices
✓ Architecture patterns reflected in structure
✓ Orchestrator configured (no direct code editing)
✓ Communication protocol established
```

## Critical Rules

1. **ALWAYS CREATE FOLDERS** if they don't exist - never assume structure
2. **NO CONTEXT FILES** - Only CLAUDE.md files in slice folders
3. **Main orchestrator NEVER writes code** - only coordinates
4. **Each slice agent ONLY modifies its slice** - reports cross-slice needs
5. **Context slice stays MINIMAL** - maximum 5 global invariants
6. **CLAUDE.md files self-update** - maintain current patterns after each use
7. **PRD.md takes precedence** if found
8. **Architecture docs override** default folder patterns
9. **Create complete structure** even from just documentation
10. **Forward-looking specs** for folders without code yet

## Execution Instructions

1. **Document Check**:
   ```
   IF (PRD.md exists):
     Parse PRD for project requirements
   IF (architecture.md or ARCHITECTURE.md exists):
     Parse for architectural decisions
   IF (README.md exists):
     Parse for project type and structure hints
   ```

2. **Folder Structure Decision**:
   ```
   IF (only documentation exists, no code folders):
     CREATE complete folder structure based on:
       1. Architecture document (highest priority)
       2. PRD specifications
       3. Default patterns for detected project type
   ELSE IF (some folders exist):
     ANALYZE existing structure
     CREATE missing folders to reach 7 slices
     PRESERVE existing folder patterns
   ELSE:
     USE existing folders as slices
   ```

3. **Create Folder Structure** (when needed):
   ```bash
   # Example for React project from PRD
   mkdir -p src/components
   mkdir -p src/hooks  
   mkdir -p src/services
   mkdir -p src/store
   mkdir -p src/utils
   mkdir -p src/api
   mkdir -p src/styles
   mkdir -p context
   
   # Create CLAUDE.md in each
   touch CLAUDE.md
   touch src/components/CLAUDE.md
   touch src/hooks/CLAUDE.md
   # ... etc for all slices
   ```

4. **Generate CLAUDE.md Files**:
   - **For existing folders**: Analyze code and extract patterns
   - **For new folders**: Create forward-looking specifications based on PRD/architecture
   - **Always include**: Self-updating mechanisms

5. **Special Case - Documentation Only**:
   When only PRD/docs exist:
   - Generate complete project structure
   - Create "specification-based" CLAUDE.md files
   - Include "to be implemented" sections
   - Add examples from PRD requirements

6. **Validate Structure**:
   - Ensure exactly 8 slices exist (7 app + 1 context)
   - Verify all folders are created if needed
   - Confirm CLAUDE.md in each slice folder
   - Check alignment with architecture docs

Begin analysis now. First check for PRD.md and architecture documents, then either analyze existing folders OR create the complete structure based on requirements.