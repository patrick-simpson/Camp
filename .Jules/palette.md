## 2024-10-15 - Add ARIA label to chat clear button
**Learning:** Found an icon-only button (🧹) used to clear chat channels in `chat.js` that was lacking an `aria-label` attribute, although it had a `title` attribute.
**Action:** Added `aria-label="Clear this channel"` to `<button id="chat-clear-btn" ...>` to improve accessibility for screen readers. Next time, make sure to search for `title="..."` attributes on buttons to find candidates that might be missing `aria-label`.
