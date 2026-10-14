import { useEffect, type RefObject } from "react";

type AutoHideOptions = {
  playerStatus: string;
  isBuffering: boolean;
  chatComposer: boolean;
  showChatHistory: boolean;
  fullscreen: boolean;
  theatreMode: boolean;
};

export function usePlayerAutoHide(
  playerRef: RefObject<HTMLDivElement | null>,
  {
    playerStatus,
    isBuffering,
    chatComposer,
    showChatHistory,
    fullscreen,
    theatreMode,
  }: AutoHideOptions,
) {
  const immersivePlayer = fullscreen || theatreMode;
  useEffect(() => {
    const screen = playerRef.current;
    if (
      !screen ||
      playerStatus !== "ready" ||
      isBuffering ||
      (fullscreen && (chatComposer || showChatHistory))
    )
      return;
    let timer: ReturnType<typeof setTimeout>;
    let keyboardInteraction = document.activeElement?.matches(":focus-visible") ?? false;
    let pointerDown = false;
    let touchInteraction = !window.matchMedia("(hover: hover)").matches;
    let pointerOverControls = !!screen.querySelector(".player-actions:hover, .live-state:hover");
    const quickFade = theatreMode && !fullscreen;
    const reveal = (event?: Event) => {
      if (event?.type === "keydown") keyboardInteraction = true;
      else if (event?.type.startsWith("pointer")) keyboardInteraction = false;
      if (event instanceof PointerEvent) {
        touchInteraction = event.pointerType === "touch";
        pointerOverControls =
          event.target instanceof Element &&
          screen.contains(event.target) &&
          !!event.target.closest(".player-actions, .live-state");
      }
      if (event?.type === "pointerdown") pointerDown = true;
      screen.classList.remove("cursor-idle");
      clearTimeout(timer);
      timer = setTimeout(
        () => {
          const focused = document.activeElement;
          if (
            (immersivePlayer || screen.matches(":hover")) &&
            !pointerDown &&
            !(quickFade && !touchInteraction && pointerOverControls) &&
            !screen.querySelector("details[open], dialog[open]") &&
            !(
              keyboardInteraction &&
              focused?.matches(
                "input, textarea, select, summary, button, a, [contenteditable='true']",
              ) &&
              screen.contains(focused)
            )
          )
            screen.classList.add("cursor-idle");
        },
        quickFade && !touchInteraction && !pointerOverControls ? 600 : 3_000,
      );
    };
    const leave = () => {
      pointerOverControls = false;
      if (immersivePlayer) reveal();
      else {
        clearTimeout(timer);
        screen.classList.remove("cursor-idle");
      }
    };
    const release = (event: Event) => {
      if (!pointerDown) return;
      pointerDown = false;
      reveal(event);
    };
    const events = ["pointermove", "pointerdown", "pointerenter", "keydown", "focusin", "focusout"];
    for (const event of events) screen.addEventListener(event, reveal);
    screen.addEventListener("pointerleave", leave);
    screen.addEventListener("toggle", reveal, true);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    document.addEventListener("fullscreenchange", reveal);
    reveal();
    return () => {
      clearTimeout(timer);
      screen.classList.remove("cursor-idle");
      for (const event of events) screen.removeEventListener(event, reveal);
      screen.removeEventListener("pointerleave", leave);
      screen.removeEventListener("toggle", reveal, true);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      document.removeEventListener("fullscreenchange", reveal);
    };
  }, [
    playerRef,
    playerStatus,
    isBuffering,
    chatComposer,
    showChatHistory,
    fullscreen,
    immersivePlayer,
    theatreMode,
  ]);
}
