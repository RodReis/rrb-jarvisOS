```markdown
# rrb-jarvisOS Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `rrb-jarvisOS` repository. The codebase is written in TypeScript and does not use a specific framework. It emphasizes clear file naming, consistent import/export styles, and conventional commit messages. This guide will help you contribute code that fits seamlessly with the existing project structure.

## Coding Conventions

### File Naming
- **PascalCase** is used for all file names.
  - Example: `UserProfile.ts`, `MainService.ts`

### Import Style
- **Relative imports** are used throughout the codebase.
  - Example:
    ```typescript
    import { UserService } from './UserService';
    ```

### Export Style
- **Named exports** are preferred.
  - Example:
    ```typescript
    export function startApp() { ... }
    export const VERSION = '1.0.0';
    ```

### Commit Messages
- **Conventional commit** format is used.
- Common prefixes: `chore`, `docs`
- Average commit message length: ~54 characters
  - Example:
    ```
    chore: update dependencies to latest versions
    docs: add API usage instructions to README
    ```

## Workflows

### Creating a New Module
**Trigger:** When adding a new feature or logical component.
**Command:** `/new-module`

1. Create a new TypeScript file using PascalCase (e.g., `FeatureModule.ts`).
2. Use named exports for all functions, classes, or constants.
3. Import dependencies using relative paths.
4. Write a corresponding test file named `FeatureModule.test.ts` if applicable.

### Writing Documentation
**Trigger:** When updating or adding documentation.
**Command:** `/update-docs`

1. Use the `docs:` prefix in your commit message.
2. Update or create relevant markdown files.
3. Ensure documentation is clear and follows markdown best practices.

### Maintenance Tasks
**Trigger:** When performing non-functional changes (e.g., dependency updates).
**Command:** `/chore`

1. Use the `chore:` prefix in your commit message.
2. Clearly describe the maintenance task performed.
3. Ensure no functional code is unintentionally altered.

## Testing Patterns

- Test files follow the pattern `*.test.*` (e.g., `UserService.test.ts`).
- The testing framework is not specified; follow existing test file structures.
- Place test files alongside the modules they test or in a dedicated test directory.
- Example test file structure:
  ```typescript
  import { startApp } from './MainService';

  describe('startApp', () => {
    it('should initialize the application', () => {
      // test implementation
    });
  });
  ```

## Commands
| Command        | Purpose                                      |
|----------------|----------------------------------------------|
| /new-module    | Scaffold a new module with proper conventions|
| /update-docs   | Add or update documentation                  |
| /chore         | Perform maintenance or non-functional changes |
```
