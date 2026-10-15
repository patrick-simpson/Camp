1. **Find UX opportunity**: `chat-clear-btn` in `chat.js` is an icon-only button without an `aria-label`.
2. **Make change**: Add `aria-label="Clear this channel"` to `<button id="chat-clear-btn" ...>`. It currently only has `title="Clear this channel"`.
3. **Verify change**: Use `grep` to verify the `aria-label` was added correctly.
4. **Run commands**: Run `node tests/run.js` to ensure nothing breaks (this project uses a custom test runner, no `package.json` with standard `pnpm` scripts).
5. **Complete pre commit steps**: Complete pre commit steps to ensure proper testing, verification, review, and reflection are done.
6. **Submit PR**: Submit the PR.
