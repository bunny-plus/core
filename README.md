# bunny.plus

## Persistent room chat

The backend stores the newest 200 room messages in SQLite. `CHAT_DB_PATH` defaults to
`data/chat.sqlite`. History remains available when viewers close the room and across backend
process restarts, but replacing the container resets it unless you explicitly mount `/app/data`.
