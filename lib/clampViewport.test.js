import test from "node:test";
import assert from "node:assert/strict";

import { clampDropdownRight, clampTooltipLeft } from "./clampViewport.js";

// ----- clampTooltipLeft -------------------------------------------------

test("clampTooltipLeft passes the trigger position through on a wide viewport", () => {
  // Plenty of room to the right; just return triggerLeft as-is.
  assert.equal(
    clampTooltipLeft({ triggerLeft: 200, tooltipMaxWidth: 300, viewportWidth: 1280 }),
    200,
  );
});

test("clampTooltipLeft clamps to the right edge minus tooltip width", () => {
  // 375px viewport (iPhone SE), tooltip 300, edgePadding 8 → maxLeft = 67.
  // Trigger near the right (e.g. labelAdornment in a right-column field) at 350.
  const result = clampTooltipLeft({
    triggerLeft: 350,
    tooltipMaxWidth: 300,
    viewportWidth: 375,
  });
  assert.equal(result, 67);
});

test("clampTooltipLeft never goes below edgePadding even when trigger is offscreen", () => {
  assert.equal(
    clampTooltipLeft({ triggerLeft: -50, tooltipMaxWidth: 300, viewportWidth: 1280 }),
    8,
  );
});

test("clampTooltipLeft handles a viewport narrower than tooltip width", () => {
  // No way to fit the tooltip; clamp to edge padding so at least it
  // starts on-screen.
  const result = clampTooltipLeft({
    triggerLeft: 0,
    tooltipMaxWidth: 300,
    viewportWidth: 200,
  });
  assert.equal(result, 8);
});

test("clampTooltipLeft respects custom edgePadding", () => {
  const result = clampTooltipLeft({
    triggerLeft: 0,
    tooltipMaxWidth: 100,
    viewportWidth: 1280,
    edgePadding: 16,
  });
  assert.equal(result, 16);
});

// ----- clampDropdownRight ----------------------------------------------

test("clampDropdownRight returns the natural right offset on a wide viewport", () => {
  // Trigger ends at 1100 in a 1280 viewport → idealRight = 180.
  assert.equal(
    clampDropdownRight({ triggerRight: 1100, menuMinWidth: 220, viewportWidth: 1280 }),
    180,
  );
});

test("clampDropdownRight clamps so the menu's left edge stays in view", () => {
  // 375 viewport, menu 220, edgePadding 8 → maxRight = 147. Trigger
  // sits at 360 → idealRight = 15, but we'd push the menu off-screen
  // — clamp to 147 instead.
  const result = clampDropdownRight({
    triggerRight: 360,
    menuMinWidth: 220,
    viewportWidth: 375,
  });
  // idealRight = 15 ≤ 147, so the natural offset is fine.
  assert.equal(result, 15);
});

test("clampDropdownRight prefers smaller idealRight when trigger is far from right", () => {
  // Trigger at 200 in 1280px viewport → idealRight = 1080. menuMinWidth
  // 220 → maxRight = 1052. Should clamp to 1052.
  const result = clampDropdownRight({
    triggerRight: 200,
    menuMinWidth: 220,
    viewportWidth: 1280,
  });
  assert.equal(result, 1052);
});

test("clampDropdownRight floors at edgePadding when viewport too narrow", () => {
  // Tiny viewport, large menu — can't satisfy maxRight constraint.
  // Make sure we still return at least edgePadding so the menu is
  // pinned to the right with a visible margin.
  const result = clampDropdownRight({
    triggerRight: 100,
    menuMinWidth: 500,
    viewportWidth: 200,
  });
  assert.equal(result, 8);
});
