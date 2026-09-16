# Agent Instructions

1. Read `Docker-Index.md` at the stable project-documentation location before editing.
2. Read and update `Docker-Current-Task.md` for the one active task.
3. Follow `Docker-Plan.md`, `Docker-Lib.md`, `Docker-Conventions.md`, and `Docker-Test.md` for their authoritative topics.
4. Do not add a package, image family, persistent service, or unrelated feature without approval.
5. Preserve existing user work and run the verification required by the current task.

## Governing documentation location

Authoritative project notes live outside this repository at:

```
C:\Users\Naofumi\Documents\Obsidian Vault\project docker\
```

- `Docker-Index.md` — entry point and instruction precedence
- `Docker-Current-Task.md` — single active task record
- `Docker-Plan.md` — product requirements
- `Docker-Lib.md` — approved dependencies and Docker images
- `Docker-Template.md` — setup and configuration templates
- `Docker-Conventions.md` — implementation conventions
- `Docker-Test.md` — verification requirements

An agent must not search the computer for these files. Use the absolute path above.

## Dependency changes

Before any package command:

1. Confirm the package and active feature are approved by `Docker-Lib.md` and the current task.
2. Use a reviewed, mutually compatible exact version; never add `PIN_VERSION`, `latest`, or a floating range.
3. Run `npm install` so npm updates the relevant `package-lock.json`; never hand-edit a lockfile.
4. Record dependency changes and verification in `Docker-Current-Task.md`.

This directory is not currently a Git repository by user decision, so do not claim a lockfile or task change was committed.
