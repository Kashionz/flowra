/**
 * Bounded past / future stacks for undo / redo.
 *
 * Pure data structure — no React, no effects. The hook in
 * `hooks/useScenarioHistory.js` wraps this with state + a coalescing
 * timer; the structure itself only knows how to push / undo / redo /
 * trim with a fixed limit.
 *
 * Each operation returns the value the caller should treat as "current"
 * (or null when the operation was a no-op), keeping the stack itself
 * decoupled from React's render cycle.
 */
export class HistoryStack {
  constructor(limit = 50) {
    if (!Number.isFinite(limit) || limit < 1) {
      throw new RangeError("HistoryStack limit must be a positive integer");
    }
    this.limit = Math.floor(limit);
    this.past = [];
    this.future = [];
  }

  /**
   * Record `previous` as a new history entry. Drops the future stack
   * (the standard "branching" semantics of editor history). Trims past
   * to the configured limit by discarding the oldest entry.
   */
  push(previous) {
    if (previous === undefined) return;
    this.past.push(previous);
    while (this.past.length > this.limit) {
      this.past.shift();
    }
    this.future = [];
  }

  /**
   * Move one step back. Pops the most recent past entry and pushes
   * `current` onto the future stack so redo can recover it.
   * Returns the value to render, or `null` if there's nothing to undo.
   */
  undo(current) {
    if (this.past.length === 0) return null;
    const previous = this.past.pop();
    this.future.push(current);
    while (this.future.length > this.limit) {
      this.future.shift();
    }
    return previous;
  }

  /**
   * Inverse of undo. Pops from future, pushes current onto past.
   */
  redo(current) {
    if (this.future.length === 0) return null;
    const next = this.future.pop();
    this.past.push(current);
    while (this.past.length > this.limit) {
      this.past.shift();
    }
    return next;
  }

  /** Drop all history without changing the caller's current value. */
  clear() {
    this.past = [];
    this.future = [];
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  /** Snapshot for debugging / serialisation; never returns the same array. */
  inspect() {
    return {
      past: this.past.slice(),
      future: this.future.slice(),
      limit: this.limit,
    };
  }
}
