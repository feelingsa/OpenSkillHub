---
name: m4-generation
description: Generate a concise operational page for a deterministic text transformation task.
---

# M4 Generation Validation

## Inputs

- `sourceText`: required text to transform
- `style`: optional output style, one of `plain`, `structured`

## Output

Return the transformed text as a downloadable text artifact.

## Workflow

1. Validate the supplied text.
2. Transform it using the selected style.
3. Save the result as a text artifact.
