# G3 — chat (reported ~6:50 PM ET Mon) — fixes by Opus in the opus-sync worktree

| id | real | sev | fix (short) | status |
|---|---|---|---|---|
| chat#1 = rules#1 | ✅ (real SDK + emulator) | med | Sends while a photo uploads / queued offline hit the 1 s rules floor ⇒ refused, text lost (child_removed fires BEFORE the reject, rebuilding the composer). Serialize chatAtomicSend on one chain keyed on ACK time + CHAT_MIN_SEND_MS; retry once after CHAT_MIN_SEND_MS with the stamp (no-stamp fallback → last resort only); failure handler looks up #chat-input at failure time. Behavioural test with a never-resolving fake update(). Update CLAUDE.md "retries without the stamp". | todo |
| chat#2 | ✅ | HIGH | In a channel with ≥ 50 messages every new message (window slide ⇒ child_removed) fully rebuilds the open view, wiping the draft + keyboard. onChatMsgRemoved removes just that bubble (+ orphan day separator; empty ⇒ full render); renderChatView(true) carries draft/selection/focus/scroll across SAME-channel rebuilds. | todo |
| chat#3 | ✅ | med | Messages arriving while the open chat's tab is hidden are never drawn, then marked read. Append when chatOpenNow() && chatViewBuiltFor === ch regardless of visibility; mark seen only when viewing. | todo |
| chat#4 = rules#3 | ✅ | low | Window back-fill (a delete/refused send pulls the 51st message back) is announced as new + appended at the bottom. Detect `chatReady[ch] && list.length > 1 && list[0].id === msg.id` ⇒ no alert/seen/append; re-render (draft-preserving). | todo |
| chat#5 = pages#4 | ✅ | med | renderAnnouncements rebuilds the editor's announcement composer every 30 s (and on each Announcements chat message) ⇒ half-typed text erased. Skip when the html is unchanged; else carry the draft across. | todo |
| chat#6 | ✅ | low | renderChatBadges() at end of onChatMsgAdded/Removed; markChannelSeen = max(serverNow(), newest at in that channel, capped at serverNow()+5 s). | todo |
