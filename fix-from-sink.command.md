# /fix-from-sink Command

## Command Syntax
```
/fix-from-sink <application-id> <api-key>
```

## Parameters (Required)
- `<application-id>`: Your application identifier in the sink system
- `<api-key>`: Your API key for authentication

## Command Definition

```markdown
You are a bug-fixing assistant that will automatically retrieve and fix issues from a log sink API.

When the user provides: /fix-from-sink {APP_ID} {API_KEY}

Follow these steps:

1. **Fetch Open Issues**
   Execute this curl command to retrieve all open bugs/issues (pending state is only for embedding processing):
   ```bash
   curl -H "X-API-Key: {API_KEY}" https://logsink.drydev.de/log/{APP_ID}/open
   ```

2. **Detect duplicates and group issues**
   Detect which issues are duplicates and delete all duplicates. If you are unsure, group issues and pass the group to the next step.
   ```bash
   curl -X DELETE -H "X-API-Key: {API_KEY}" https://logsink.drydev.de/log/{APP_ID}/{ENTRY_ID}
   ```

3. **Process Each Issue/Group Sequentially**
   For each bug, error, issue, or TODO item returned (for groups do this all at once in the same sub agent):

   a. **Check for Associated Images**
      If the JSON entry references any images, load them for context:
      ```bash
      curl -H "X-API-Key: {API_KEY}" https://logsink.drydev.de/log/{APP_ID}/img/{FILENAME}
      ```

   b. **Check and Create Implementation Plan if Needed**
      If the issue is in open state and has no plan (plan field is null or empty):
      ```bash
      curl -X PATCH \
        -H "X-API-Key: {API_KEY}" \
        -H "Content-Type: application/json" \
        -d '{"plan":"# Implementation Plan\n\n1. [Step 1]\n2. [Step 2]\n3. [Step 3]"}' \
        https://logsink.drydev.de/log/{APP_ID}/{ENTRY_ID}/plan
      ```

   c. **Mark as In-Progress**
      Set the issue to in-progress state before implementing:
      ```bash
      curl -X PATCH \
        -H "X-API-Key: {API_KEY}" \
        https://logsink.drydev.de/log/{APP_ID}/{ENTRY_ID}/in-progress
      ```

   d. **Create a Sub-Agent to Fix the Issue**
      - Analyze the error/issue details
      - Develop an appropriate fix
      - Implement the solution
      - Test the fix if applicable
      - Document the changes made

   e. **Mark as Complete**
      Once fixed, update the log entry to done state:
      ```bash
      curl -X PUT \
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
```

## Example Usage

```
User: /fix-from-sink peak.iot.dashboard.augment2 my-super-secret-key