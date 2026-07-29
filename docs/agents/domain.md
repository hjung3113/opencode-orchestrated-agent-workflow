# Domain docs

This is a single-context repository.

## Before exploring

Read the root `CONTEXT.md` and any ADR in `docs/adr/` relevant to the task.
If an expected document does not exist, proceed without treating that absence
as a defect. Domain modeling creates new terminology and ADRs only when a real
term or durable decision has been resolved.

## Consumer rules

- Use the vocabulary in `CONTEXT.md` in issues, specifications, tests, and
  proposals; do not silently substitute a glossary term with a synonym.
- If a needed concept is absent, note it for domain modeling rather than
  treating a newly invented name as established vocabulary.
- Surface a conflict with an ADR explicitly; do not silently override it.
