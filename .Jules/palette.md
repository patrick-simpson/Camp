## 2024-05-18 - Missing ARIA Labels on Buttons
**Learning:** Icon-only buttons (like `#chat-clear-btn` which contains only the 🧹 emoji) need an explicit `aria-label` even if they have a `title` attribute, as screen readers might not always read `title` reliably.
**Action:** Always add an `aria-label` to buttons that don't have visible text labels.
