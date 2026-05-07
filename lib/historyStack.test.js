import test from "node:test";
import assert from "node:assert/strict";

import { HistoryStack } from "./historyStack.js";

test("HistoryStack rejects non-positive limits", () => {
  assert.throws(() => new HistoryStack(0));
  assert.throws(() => new HistoryStack(-1));
  assert.throws(() => new HistoryStack(NaN));
});

test("new HistoryStack starts empty", () => {
  const stack = new HistoryStack(10);
  assert.equal(stack.canUndo, false);
  assert.equal(stack.canRedo, false);
  assert.deepEqual(stack.inspect(), { past: [], future: [], limit: 10 });
});

test("push records past entries and clears future", () => {
  const stack = new HistoryStack();
  stack.push("a");
  stack.push("b");
  stack.push("c");
  assert.equal(stack.canUndo, true);
  assert.equal(stack.canRedo, false);
  assert.deepEqual(stack.inspect().past, ["a", "b", "c"]);
});

test("push ignores undefined entries (no implicit history pollution)", () => {
  const stack = new HistoryStack();
  stack.push(undefined);
  assert.equal(stack.canUndo, false);
  stack.push(null);
  assert.equal(stack.canUndo, true); // null is a real value
});

test("undo returns the previous entry and pushes current onto future", () => {
  const stack = new HistoryStack();
  stack.push("v1");
  stack.push("v2");
  // current = v3
  assert.equal(stack.undo("v3"), "v2");
  assert.equal(stack.canRedo, true);
  assert.equal(stack.undo("v2"), "v1");
  assert.equal(stack.undo("v1"), null); // empty past now
});

test("redo restores from the future stack", () => {
  const stack = new HistoryStack();
  stack.push("a");
  stack.push("b");
  const u1 = stack.undo("c");
  assert.equal(u1, "b");
  const u2 = stack.undo("b");
  assert.equal(u2, "a");
  // Now redo all the way back.
  const r1 = stack.redo("a");
  assert.equal(r1, "b");
  const r2 = stack.redo("b");
  assert.equal(r2, "c");
  assert.equal(stack.redo("c"), null);
});

test("push after undo discards the future (no time-travel branching)", () => {
  const stack = new HistoryStack();
  stack.push("a");
  stack.push("b");
  stack.undo("c"); // current is now "b"
  assert.equal(stack.canRedo, true);
  stack.push("b"); // user makes a new edit
  assert.equal(stack.canRedo, false);
});

test("limit trims oldest past entries when exceeded", () => {
  const stack = new HistoryStack(3);
  for (const value of ["a", "b", "c", "d", "e"]) {
    stack.push(value);
  }
  assert.deepEqual(stack.inspect().past, ["c", "d", "e"]);
});

test("undo across 30+ steps still walks back through history", () => {
  // The exact scenario from the manual verification list: long edit
  // session, Cmd+Z should keep going back.
  const stack = new HistoryStack(50);
  for (let i = 0; i < 30; i += 1) {
    stack.push(`step-${i}`);
  }
  assert.equal(stack.canUndo, true);

  let current = "step-30";
  const seen = [];
  while (stack.canUndo) {
    current = stack.undo(current);
    seen.push(current);
  }
  // Walked 30 steps back, ending at step-0.
  assert.equal(seen.length, 30);
  assert.equal(seen[0], "step-29");
  assert.equal(seen[seen.length - 1], "step-0");
  assert.equal(stack.canUndo, false);
  assert.equal(stack.canRedo, true);
});

test("clear empties both stacks", () => {
  const stack = new HistoryStack();
  stack.push("a");
  stack.push("b");
  stack.undo("c");
  stack.clear();
  assert.equal(stack.canUndo, false);
  assert.equal(stack.canRedo, false);
});
