/**
 * Layout helpers that keep portal-rendered floats inside the viewport
 * on narrow screens. Pure math — no DOM access, no React. The
 * components feed their getBoundingClientRect() values in.
 */

/**
 * Compute a left coordinate for a tooltip rendered via portal at the
 * trigger's bottom-left, clamped so it never extends past the right
 * edge of the viewport.
 *
 * - triggerLeft: the trigger button's clientRect.left
 * - tooltipMaxWidth: the tooltip's expected width (use the tooltip's
 *   max-width / measured width)
 * - viewportWidth: window.innerWidth
 * - edgePadding: minimum distance from either edge (defaults to 8px)
 */
export function clampTooltipLeft({ triggerLeft, tooltipMaxWidth, viewportWidth, edgePadding = 8 }) {
  const minLeft = edgePadding;
  const maxLeft = Math.max(edgePadding, viewportWidth - tooltipMaxWidth - edgePadding);
  return Math.min(Math.max(minLeft, triggerLeft), maxLeft);
}

/**
 * Compute a right offset for a dropdown menu anchored to the right
 * edge of its trigger. Mirrors clampTooltipLeft for "right" anchoring.
 *
 * - triggerRight: rect.right of the trigger
 * - menuMinWidth: minimum width the menu wants
 * - viewportWidth: window.innerWidth
 * - edgePadding: minimum distance from either edge (defaults to 8px)
 */
export function clampDropdownRight({ triggerRight, menuMinWidth, viewportWidth, edgePadding = 8 }) {
  const idealRight = viewportWidth - triggerRight;
  const maxRight = Math.max(edgePadding, viewportWidth - menuMinWidth - edgePadding);
  return Math.max(edgePadding, Math.min(idealRight, maxRight));
}
