## 2024-05-18 - Fix unescaped team emoji HTML interpolation
**Vulnerability:** Unescaped DOM manipulation in Catchup Text. `teamEmoji` values were directly injected into `innerHTML` strings in `renderCatchupHint()`.
**Learning:** `teamEmoji` looks up a dictionary and if an attacker managed to control the dictionary value or team ID, they could trigger XSS, as `esc()` was absent either in the dictionary lookup or the template variables.
**Prevention:** Use `esc()` inside helper functions that emit HTML fragments or strings, or always wrap dynamic variables with `esc()` during `innerHTML` assignments. Prevent double escaping by only applying it once.
