import type { CSSProperties } from "react";
import { AssetIcon } from "./Icons";
import { parseChatEffects } from "./chat-effects";
import type { OverlayChat, OverlayReaction } from "./useRoomConnection";
import type { ChatDisplayMode } from "./usePlayerPreferences";

type RoomStyle = CSSProperties & {
  "--character-index"?: number;
  "--chat-x"?: string;
  "--chat-y"?: string;
  "--reaction-x"?: string;
};

function roomStyle(style: RoomStyle): CSSProperties {
  return style;
}

export function ChatMessage({
  message,
  scrolling = false,
}: {
  message: string;
  scrolling?: boolean;
}) {
  const effects = parseChatEffects(message);
  if (!scrolling) return effects.text;
  const classes = [
    "runescape-chat-text",
    effects.color && `runescape-color-${effects.color}`,
    effects.motion && `runescape-motion-${effects.motion}`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} aria-label={effects.text}>
      {[...effects.text].map((character, index) => (
        <span
          className="runescape-chat-character"
          style={roomStyle({ "--character-index": index })}
          aria-hidden="true"
          key={index}
        >
          {character === " " ? "\u00a0" : character}
        </span>
      ))}
    </span>
  );
}

export default function RoomOverlay({
  reactions,
  chats,
  chatDisplayMode,
}: {
  reactions: OverlayReaction[];
  chats: OverlayChat[];
  chatDisplayMode: ChatDisplayMode;
}) {
  return (
    <div className="reaction-layer" aria-live="polite" aria-relevant="additions">
      {reactions.map((reaction) => (
        <span
          className="room-reaction"
          style={roomStyle({ "--reaction-x": `${reaction.x}%` })}
          key={reaction.id}
        >
          <span className="sr-only">{reaction.member.name} reacted</span>
          <AssetIcon name={reaction.variant} />
          <strong aria-hidden="true">{reaction.member.name}</strong>
        </span>
      ))}
      {chats.map((chat) =>
        chatDisplayMode === "scrolling" ? (
          <span
            className="room-chat-scroll"
            style={roomStyle({ "--chat-y": `${12 + chat.lane * 13}%` })}
            key={chat.id}
          >
            <strong>{chat.member.name}</strong>
            <span aria-hidden="true">: </span>
            <ChatMessage message={chat.message} scrolling />
          </span>
        ) : (
          <span className="room-chat" style={roomStyle({ "--chat-x": `${chat.x}%` })} key={chat.id}>
            <span className="room-chat-avatar" aria-hidden="true">
              {chat.member.avatar ? (
                <img src={chat.member.avatar} alt="" />
              ) : (
                <span>{chat.member.name[0]?.toUpperCase()}</span>
              )}
            </span>
            <span className="room-chat-bubble">
              <strong aria-hidden="true">{chat.member.name}</strong>
              <span className="sr-only">{chat.member.name} says: </span>
              <span>
                <ChatMessage message={chat.message} />
              </span>
            </span>
          </span>
        ),
      )}
    </div>
  );
}
