---
name: conversation-realtime-sync
description: Preserve Velora Mobile chat identity, optimistic/offline messaging, local persistence, realtime reconciliation, timeline ordering, anchors, and read-frontier semantics.
---

# Conversation Realtime Sync

Use this skill for message send/fetch changes, optimistic messages, offline chat, WatermelonDB message sync, reply jumps, timeline pagination, receipts, or realtime socket handling.

## Preserve these invariants

- `clientMessageId` is the reconciliation identity between optimistic/local records and confirmed server messages. Do not create a second identity scheme.
- Text sends use the Socket.IO `send_message` path. When the socket is unavailable, preserve the existing optimistic/offline queue behavior instead of silently switching transport.
- React Query, Zustand optimistic state, and WatermelonDB must converge on one logical message after confirmation; avoid duplicate server and temp records.
- Confirmed server messages must remove or supersede their matching optimistic entries without losing local receipt information accumulated while pending.
- Preserve canonical newest-first ordering and optimistic sort anchors across confirmation, pagination, and local persistence.
- Keep latest-timeline and anchor-timeline behavior distinct. Reply jumps may resolve an anchored window without corrupting the latest feed.
- Read frontiers apply only through the selected frontier and must not mark the reader's own messages as read.
- Realtime updates must update both message state and conversation summary/cache state when the current code path expects both.

## Verify changes

Run the focused conversation contracts related to the edited behavior, especially the `chat-timeline-*`, `chat-realtime-*`, `chat-incoming-message-*`, `conversation-*`, and group-chat contract tests in `tests/`.

Trace changes through `src/hooks/useMessages.ts`, `src/hooks/conversation/`, `src/database/messageSync.ts`, `src/stores/chatStore.ts`, and `src/lib/conversation/` before changing ordering or identity behavior.
