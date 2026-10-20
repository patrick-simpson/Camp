## 2024-10-20 - Missing Focus Rings on summary tags
**Learning:** The `<summary>` tag, which is the interactive element for the `<details>` component, was missing visual focus indicators. This means keyboard users couldn't tell when they had selected it, breaking accessibility for features like "Alternative sign in" and "How to play".
**Action:** Always include `summary` in the list of interactive tags when creating a global `:focus-visible` rule.
