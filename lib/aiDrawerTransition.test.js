import test from "node:test";
import assert from "node:assert/strict";
import { AI_DRAWER_CLOSE_MS, getAiDrawerMotion } from "./aiDrawerTransition.js";

test("getAiDrawerMotion exposes visible styles while opening", () => {
  const motion = getAiDrawerMotion({ open: true });

  assert.equal(motion.overlayStyle.opacity, 1);
  assert.equal(motion.overlayStyle.visibility, "visible");
  assert.equal(motion.drawerStyle.transform, "translateX(0)");
  assert.match(motion.drawerStyle.transition, /280ms/);
});

test("getAiDrawerMotion keeps exit transition styles while closing", () => {
  const motion = getAiDrawerMotion({ open: false });

  assert.equal(motion.overlayStyle.opacity, 0);
  assert.equal(motion.overlayStyle.visibility, "hidden");
  assert.equal(motion.drawerStyle.transform, "translateX(100%)");
  assert.match(motion.drawerStyle.transition, /240ms/);
});

test("AI drawer close duration covers the exit animation", () => {
  assert.ok(AI_DRAWER_CLOSE_MS >= 240);
});
