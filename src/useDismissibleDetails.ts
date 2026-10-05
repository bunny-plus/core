import { useEffect, type RefObject } from "react";

export function useDismissibleDetails(ref: RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    function dismissOutside(event: Event) {
      const menu = ref.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target))
        menu.open = false;
    }

    function dismissWithEscape(event: KeyboardEvent) {
      const menu = ref.current;
      if (event.key !== "Escape" || !menu?.open) return;
      event.preventDefault();
      menu.open = false;
      menu.querySelector("summary")?.focus({ preventScroll: true });
    }

    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissWithEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissWithEscape);
    };
  }, [ref]);
}
