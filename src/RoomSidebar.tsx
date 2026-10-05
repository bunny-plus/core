import { useEffect, useRef, useState } from "react";

import { UiIcon } from "./Icons";
import { parseChatEffects } from "./chat-effects";
import type { RoomChat, User } from "./WatchRoom";

const maxPresencePhotos = 6;

function MemberPhoto({ member }: { member: Pick<User, "name" | "avatar"> }) {
  return (
    <span className="room-member-photo" aria-hidden="true">
      {member.avatar ? <img src={member.avatar} alt="" /> : member.name[0]?.toUpperCase()}
    </span>
  );
}

export default function RoomSidebar({
  currentUser,
  members,
  messages,
  messageSequence,
  open,
  fullscreen,
  composeRequest,
  draft,
  onDraftChange,
  onOpenChange,
  onSend,
}: {
  currentUser: User;
  members: User[];
  messages: RoomChat[];
  messageSequence: number;
  open: boolean;
  fullscreen: boolean;
  composeRequest: number;
  draft: string;
  onDraftChange: (message: string) => void;
  onOpenChange: (open: boolean) => void;
  onSend: (message: string) => boolean;
}) {
  const [view, setView] = useState<"chat" | "people">("chat");
  const [atBottom, setAtBottom] = useState(true);
  const [readSequence, setReadSequence] = useState(messageSequence);
  const [sendError, setSendError] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const followingRef = useRef(true);
  const scrollTopRef = useRef(0);
  const unread = Math.max(0, messageSequence - readSequence);
  const remainingPeople = Math.max(0, members.length - maxPresencePhotos);

  useEffect(() => {
    if (open && view === "chat" && atBottom && !fullscreen) setReadSequence(messageSequence);
  }, [open, view, atBottom, fullscreen, messageSequence]);

  useEffect(() => {
    if (open && view === "chat" && logRef.current) {
      logRef.current.scrollTop = followingRef.current
        ? logRef.current.scrollHeight
        : scrollTopRef.current;
    }
  }, [messages, open, view]);

  useEffect(() => {
    if (!composeRequest) return;
    setView("chat");
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [composeRequest]);

  function changeOpen(next: boolean) {
    onOpenChange(next);
    requestAnimationFrame(() => {
      (next ? collapseRef : expandRef).current?.focus({ preventScroll: true });
    });
  }

  function showPeople() {
    setView("people");
    changeOpen(true);
  }

  function mention(member: Pick<User, "name" | "id">) {
    if (member.id === currentUser.id) return;
    onDraftChange(`@${member.name} ${draft}`.slice(0, 64));
    setView("chat");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function jumpToLatest() {
    followingRef.current = true;
    setAtBottom(true);
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }

  return (
    <aside
      className={`room-sidebar${open ? "" : " is-collapsed"}`}
      aria-label="Room chat and people"
    >
      {open ? (
        <>
          <header className="room-sidebar-heading">
            <h2>room chat</h2>
            <button
              ref={collapseRef}
              type="button"
              className="room-sidebar-icon"
              aria-label="Collapse chat"
              aria-expanded="true"
              onClick={() => changeOpen(false)}
            >
              <UiIcon name="sidebar" />
            </button>
          </header>
          <div className="room-sidebar-toolbar">
            <nav aria-label="Room sidebar">
              <button type="button" aria-pressed={view === "chat"} onClick={() => setView("chat")}>
                Chat
                {unread > 0 && <span className="room-unread">{unread > 99 ? "99+" : unread}</span>}
              </button>
              <button
                type="button"
                aria-pressed={view === "people"}
                onClick={() => setView("people")}
              >
                People <span className="room-people-count">{members.length}</span>
              </button>
            </nav>
            <button
              type="button"
              className="room-presence-stack"
              aria-label={`Show all ${members.length} people in the room`}
              title="Everyone in the room"
              onClick={() => setView("people")}
            >
              {members.slice(0, maxPresencePhotos).map((member) => (
                <MemberPhoto key={member.id} member={member} />
              ))}
              {remainingPeople > 0 && (
                <span className="room-presence-more" aria-hidden="true">
                  +{remainingPeople}
                </span>
              )}
            </button>
          </div>
          {view === "chat" ? (
            <>
              <div
                className="room-sidebar-log"
                ref={logRef}
                role="log"
                aria-label="Room messages"
                aria-live={fullscreen ? "off" : "polite"}
                aria-relevant="additions"
                tabIndex={0}
                onScroll={(event) => {
                  const log = event.currentTarget;
                  const bottom = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
                  scrollTopRef.current = log.scrollTop;
                  followingRef.current = bottom;
                  setAtBottom(bottom);
                }}
              >
                {messages.length === 0 && <p className="room-sidebar-empty">No messages yet.</p>}
                {messages.map((message) => (
                  <p className="room-sidebar-message" key={message.id}>
                    <button
                      type="button"
                      onClick={() => mention(message.member)}
                      title={
                        message.member.id === currentUser.id
                          ? "You"
                          : `Mention ${message.member.name}`
                      }
                    >
                      {message.member.name}
                    </button>{" "}
                    <span>{parseChatEffects(message.message).text}</span>
                  </p>
                ))}
              </div>
              {!atBottom && (
                <button type="button" className="room-latest" onClick={jumpToLatest}>
                  {unread ? `${unread} new · ` : ""}Jump to latest ↓
                </button>
              )}
              <form
                className="room-sidebar-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!draft.trim()) return;
                  const sent = onSend(draft);
                  setSendError(!sent);
                  if (sent) jumpToLatest();
                }}
              >
                {sendError && <p role="status">Chat is reconnecting. Try sending again.</p>}
                <div className="room-compose-field">
                  <input
                    ref={inputRef}
                    aria-label="Message the room"
                    placeholder="Say something…"
                    maxLength={64}
                    autoComplete="off"
                    value={draft}
                    onChange={(event) => {
                      onDraftChange(event.target.value);
                      setSendError(false);
                    }}
                  />
                  <button type="submit" aria-label="Send message" disabled={!draft.trim()}>
                    <UiIcon name="send" />
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="room-sidebar-people" tabIndex={0} aria-label="People in the room">
              {members.map((member) => (
                <button
                  type="button"
                  className="room-person"
                  key={member.id}
                  onClick={() => mention(member)}
                  title={member.id === currentUser.id ? "You" : `Mention ${member.name}`}
                >
                  <MemberPhoto member={member} />
                  <span>
                    <strong>
                      {member.name}
                      {member.id === currentUser.id && <small> you</small>}
                    </strong>
                    <small>In the room</small>
                  </span>
                  <i aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <button
            type="button"
            className="room-sidebar-icon room-expand"
            ref={expandRef}
            aria-label={`Expand chat${unread ? `, ${unread} unread ${unread === 1 ? "message" : "messages"}` : ""}`}
            aria-expanded="false"
            onClick={() => changeOpen(true)}
          >
            <UiIcon name="sidebar" />
            {unread > 0 && <span className="room-unread">{unread > 99 ? "99+" : unread}</span>}
          </button>
          <div className="room-rail-members" role="group" aria-label="People in the room">
            {members.map((member) => (
              <button
                className="room-rail-person"
                type="button"
                key={member.id}
                aria-label={`${member.name}${member.id === currentUser.id ? " (you)" : ""} · show people`}
                onClick={showPeople}
              >
                <MemberPhoto member={member} />
              </button>
            ))}
          </div>
          <button
            type="button"
            className="room-rail-count"
            aria-label={`Show all ${members.length} people`}
            onClick={showPeople}
          >
            {members.length}
          </button>
        </>
      )}
    </aside>
  );
}
