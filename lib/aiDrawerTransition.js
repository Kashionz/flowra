export const AI_DRAWER_CLOSE_MS = 240;

export function getAiDrawerMotion({ open }) {
  return {
    overlayStyle: {
      opacity: open ? 1 : 0,
      visibility: open ? "visible" : "hidden",
      pointerEvents: open ? "auto" : "none",
      transition: open
        ? "opacity 200ms ease-out, visibility 0s linear 0s"
        : "opacity 220ms ease-in, visibility 0s linear 220ms",
    },
    drawerStyle: {
      transform: open ? "translateX(0)" : "translateX(100%)",
      visibility: open ? "visible" : "hidden",
      pointerEvents: open ? "auto" : "none",
      transition: open
        ? "transform 280ms cubic-bezier(0.32, 0.72, 0, 1), visibility 0s linear 0s"
        : "transform 240ms cubic-bezier(0.32, 0.72, 0, 1), visibility 0s linear 240ms",
    },
  };
}
