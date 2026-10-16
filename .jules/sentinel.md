## 2025-05-18 - Enforce HTTP(S) URL scheme on links
**Vulnerability:** User-provided URLs (like `verse.video`) were only sanitized for HTML special characters but not validated for safe schemes before being rendered in `<a href="...">` tags.
**Learning:** `esc()` or HTML escaping alone doesn't prevent XSS in `href` attributes if an attacker can provide `javascript:...` links. Though CSP could block inline execution, defense-in-depth is essential.
**Prevention:** Validate URL schemes explicitly before outputting them to `href` attributes, using a centralized helper function to ensure they use safe protocols like `http:` or `https:`.
