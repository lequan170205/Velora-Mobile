from pathlib import Path

path = Path('tests/chat-realtime-regressions-contract.test.cjs')
source = path.read_text()
old = r"/const \{ unreadCount: _snapshotUnreadCount, \.\.\.conversationWithoutUnreadCount \} = conversation/"
new = r"/const \{ unreadCount: _snapshotUnreadCount, \.\.\.conversationWithoutUnreadCount \}\s*=\s*conversation/"
if old not in source:
    raise SystemExit('missing formatted unread assertion target')
path.write_text(source.replace(old, new, 1))
