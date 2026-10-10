import { useEffect, type RefObject } from "react";

export function useDismissibleDetails(
  ref: RefObject<HTMLDetailsElement | null>,
  ownerDocument = document,
) {
  useEffect(() => {
    function dismissOutside(event: Event) {
      const menu = ref.current;
      if (menu?.open && !event.composedPath().includes(menu)) menu.open = false;
    }

    function dismissWithEscape(event: KeyboardEvent) {
      const menu = ref.current;
      if (event.key !== "Escape" || !menu?.open) return;
      event.preventDefault();
      menu.open = false;
      menu.querySelector("summary")?.focus({ preventScroll: true });
    }

    ownerDocument.addEventListener("pointerdown", dismissOutside);
    ownerDocument.addEventListener("focusin", dismissOutside);
    ownerDocument.addEventListener("keydown", dismissWithEscape);
    return () => {
      ownerDocument.removeEventListener("pointerdown", dismissOutside);
      ownerDocument.removeEventListener("focusin", dismissOutside);
      ownerDocument.removeEventListener("keydown", dismissWithEscape);
    };
  }, [ref, ownerDocument]);
}
