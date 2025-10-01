# /fix-from-sink Command

## Command Syntax
```
/fix-from-sink <application-id> <api-key>
```

## Parameters (Required)
- `<application-id>`: Your application identifier in the sink system
- `<api-key>`: Your API key for authentication

## Quick Reference: Component Path Feature
When processing issues, check for `context.elementInfo.componentPath` to get the exact file path of the problematic component. This eliminates guesswork and speeds up resolution significantly.

## Issue Classification System
Each issue contains `type` and `effort` fields that determine the processing approach:

### Issue Types
- **bugfix**: Bug fixes and error corrections
- **feature**: New features and enhancements
- **documentation**: Documentation updates and improvements

### Effort Levels
- **low**: Simple changes, minimal impact (1 agent)
- **medium**: Standard development work (2 agents)
- **high**: Complex changes requiring significant effort (4 agents)
- **critical**: Urgent, high-priority work (6-8 agents)

### Multi-Agent Processing
The system automatically uses parallel sub-agents based on effort level:
- **Critical**: 8 agents for analysis, 6 agents for execution (bugfix/feature), 4 agents for documentation
- **High**: 4 agents for analysis and execution
- **Medium**: 2 agents for analysis and execution
- **Low**: Single agent (no multi-agent overhead)

**Note**: These fields are already present in the issue JSON. Do NOT attempt to update them.

## Command Definition

```markdown
You are a bug-fixing assistant that will automatically retrieve and fix issues from a log sink API.

When the user provides: /fix-from-sink {APP_ID} {API_KEY}

Follow these steps:

1. **Fetch Open Issues**
   Execute this curl command to retrieve all open bugs/issues (pending state is only for embedding processing):
   ```bash
   curl.exe -H "X-API-Key: {API_KEY}" https://logsink.drydev.de/log/{APP_ID}/open
   ```

2. **Detect duplicates and group issues**
   Detect which issues are duplicates and delete all duplicates. If you are unsure, group issues and pass the group to the next step.
   ```bash
   curl.exe -X DELETE -H "X-API-Key: {API_KEY}" https://logsink.drydev.de/log/{APP_ID}/{ENTRY_ID}
   ```

3. **Process Each Issue/Group Sequentially**
   For each bug, error, issue, or TODO item returned (for groups do this all at once in the same sub agent):

   a. **Analyze Issue Classification**
      - Read the `type` field (bugfix/feature/documentation)
      - Read the `effort` field (low/medium/high/critical)
      - Understand the multi-agent approach that will be used:
        * **Critical effort**: 8 parallel agents for analysis, 6 agents for execution (bugfix/feature) or 4 (documentation)
        * **High effort**: 4 parallel agents for both analysis and execution
        * **Medium effort**: 2 parallel agents for both analysis and execution
        * **Low effort**: Single agent, direct processing
      - Note: These fields are READ-ONLY. Do NOT attempt to modify them via API.

   b. **Check for Associated Images**
      If the JSON entry references any images, load them for context:
      ```bash
      curl.exe -H "X-API-Key: {API_KEY}" https://logsink.drydev.de/log/{APP_ID}/img/{FILENAME}
      ```

   c. **Check and Create Implementation Plan if Needed**
      If the issue is in open state and has no plan (plan field is null or empty):
      ```bash
      curl.exe -X PATCH \
        -H "X-API-Key: {API_KEY}" \
        -H "Content-Type: application/json" \
        -d '{"plan":"# Implementation Plan\n\n1. [Step 1]\n2. [Step 2]\n3. [Step 3]"}' \
        https://logsink.drydev.de/log/{APP_ID}/{ENTRY_ID}/plan
      ```

   d. **Mark as In-Progress**
      Set the issue to in-progress state before implementing:
      ```bash
      curl.exe -X PATCH \
        -H "X-API-Key: {API_KEY}" \
        https://logsink.drydev.de/log/{APP_ID}/{ENTRY_ID}/in-progress
      ```

   e. **Create Sub-Agent(s) to Fix the Issue**
      Based on the effort level, deploy the appropriate number of parallel sub-agents:

      **For ALL effort levels:**
      - Check if the issue contains a component path (context.elementInfo.componentPath)
      - If component path exists, use it to directly identify and analyze the specific component file
      - Otherwise, analyze the error/issue details to locate the relevant code

      **For Low effort (single agent):**
      - Develop an appropriate fix
      - Implement the solution
      - Test the fix if applicable
      - Document the changes made

      **For Medium effort (2 parallel agents):**
      - Deploy 2 specialized sub-agents working concurrently
      - Agent 1: Core implementation and solution development
      - Agent 2: Quality assurance, testing, validation, and documentation
      - Coordinate and integrate work from both agents

      **For High effort (4 parallel agents):**
      - Deploy 4 specialized sub-agents working concurrently
      - Agents focus on: Core implementation, UI/UX or Testing, Backend/API or Integration, Quality & Documentation
      - Orchestrate parallel workstreams for efficiency
      - Ensure architectural integrity across all components

      **For Critical effort (6-8 parallel agents):**
      - Deploy 6-8 specialized sub-agents working concurrently (varies by issue type)
      - Maximum parallelization for emergency/critical scenarios
      - Specialized agents for: Core development, UI/UX, Integration, Testing, Performance, Communication/Documentation
      - Coordinate parallel workstreams for maximum speed
      - Maintain continuous integration and validation

   f. **Mark as Complete**
      Once fixed, update the log entry to done state:
      ```bash
      curl.exe -X PUT \
        -H "X-API-Key: {API_KEY}" \
        -H "Content-Type: application/json" \
        -d '{"message":"[1-3 sentence summary of what was implemented]","git_commit":"[commit hash if applicable]"}' \
        https://logsink.drydev.de/log/{APP_ID}/{ENTRY_ID}
      ```

4. **Continue Until Complete**
   Process all open items sequentially until no open issues remain.

5. **Provide Summary**
   After all issues are resolved, provide a summary of:
   - Total issues fixed
   - Breakdown by issue type (bugfix/feature/documentation)
   - Breakdown by effort level (low/medium/high/critical)
   - Number of multi-agent deployments used
   - Brief overview of types of issues addressed
   - Any recommendations for preventing similar issues

## Error Handling
- If API authentication fails, notify the user to check their API key
- If no open issues are found, inform the user the queue is clear
- If an issue cannot be fixed automatically, flag it for manual review with detailed explanation

## Important Notes
- **Issue Lifecycle**: create → pending (embedding only) → open → in_progress → done
- The pending state is ONLY for embedding processing (automatic background process)
- Fetch from /open endpoint, not /pending
- If an open issue has no plan (plan == null), create one before starting work
- Always use the "message" property in the PUT request body (never use different property names)
- Process issues one at a time to ensure quality fixes
- Load and analyze any referenced images before attempting fixes
- Each fix should be thorough and include appropriate error handling
- Include git commit hash in the completion message when available

## Issue Classification (READ-ONLY)
- **Type and Effort fields**: These are already set in the issue JSON
- **DO NOT modify**: The REST API does not support updating type or effort fields
- **Use for processing decisions**: Read these fields to determine the appropriate multi-agent approach
- **Valid types**: bugfix, feature, documentation
- **Valid effort levels**: low, medium, high, critical
- **Multi-agent scaling**: The system automatically uses more parallel agents for higher effort levels

## Component Path Recognition
When processing issues from report mode, check for component path information:
- **Location**: `context.elementInfo.componentPath` in the issue JSON
- **Format**: Relative path from project root (e.g., `src/components/forms/SubmitButton.tsx`)
- **Usage**: If present, use this path to directly identify which component file to analyze
- **Benefits**: Eliminates guesswork and speeds up issue resolution
- **Example**:
  ```json
  {
    "context": {
      "elementInfo": {
        "componentPath": "src/components/forms/SubmitButton.tsx",
        "tagName": "BUTTON",
        "id": "submit-btn"
      }
    }
  }
  ```
- **Workflow**: When componentPath is present:
  1. Read the component file at the specified path
  2. Analyze the component code in context of the reported issue
  3. Identify the specific problem area within that component
  4. Implement the fix in the correct file
  5. Test the component to ensure the fix works
```