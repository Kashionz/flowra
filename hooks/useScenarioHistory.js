import { useCallback, useEffect, useRef, useState } from "react";

import { HistoryStack } from "../lib/historyStack.js";

const HISTORY_LIMIT = 50;
const COALESCE_MS = 600;

/**
 * Wraps a value with manual-saved past / future stacks. Consecutive
 * `setValue` calls within COALESCE_MS collapse into a single history
 * entry, so a user typing in a number field doesn't burn through the
 * 50-step buffer in one second.
 *
 * `commit()` forces a flush before the timer fires (useful before
 * structural mutations like reordering or replacing the whole value).
 *
 * The actual past / future bookkeeping lives in `lib/historyStack.js`
 * so it can be unit-tested without React.
 */
export function useUndoableState(initialValue) {
  const [value, setInternalValue] = useState(initialValue);
  const [historyState, setHistoryState] = useState({
    version: 0,
    canUndo: false,
    canRedo: false,
  });

  const stackRef = useRef(null);
  if (stackRef.current === null) {
    stackRef.current = new HistoryStack(HISTORY_LIMIT);
  }
  // Capture the resolved initial value (useState already invoked the
  // factory if `initialValue` was a function).
  const lastSnapshotRef = useRef(value);
  const coalesceTimerRef = useRef(null);

  const sync = useCallback(() => {
    const stack = stackRef.current;
    setHistoryState((prev) => ({
      version: prev.version + 1,
      canUndo: stack.canUndo,
      canRedo: stack.canRedo,
    }));
  }, []);

  const flushPending = useCallback(() => {
    if (coalesceTimerRef.current) {
      clearTimeout(coalesceTimerRef.current);
      coalesceTimerRef.current = null;
    }
  }, []);

  const pushHistoryEntry = useCallback(() => {
    if (lastSnapshotRef.current === undefined) return;
    stackRef.current.push(lastSnapshotRef.current);
    sync();
  }, [sync]);

  const setValue = useCallback(
    (next) => {
      setInternalValue((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        if (Object.is(resolved, current)) return current;

        // Schedule a coalesced history push: the *previous* snapshot
        // becomes the undo target once the user pauses long enough.
        flushPending();
        coalesceTimerRef.current = setTimeout(() => {
          pushHistoryEntry();
          lastSnapshotRef.current = resolved;
          coalesceTimerRef.current = null;
        }, COALESCE_MS);

        return resolved;
      });
    },
    [flushPending, pushHistoryEntry],
  );

  useEffect(() => {
    if (!coalesceTimerRef.current) {
      lastSnapshotRef.current = value;
    }
  }, [value]);

  const commit = useCallback(() => {
    if (coalesceTimerRef.current) {
      flushPending();
      pushHistoryEntry();
      lastSnapshotRef.current = value;
    }
  }, [flushPending, pushHistoryEntry, value]);

  const replace = useCallback(
    (next) => {
      // Wholesale replacement: push current snapshot and switch to
      // the new value, with redo cleared.
      flushPending();
      pushHistoryEntry();
      const resolved = typeof next === "function" ? next(value) : next;
      lastSnapshotRef.current = resolved;
      setInternalValue(resolved);
    },
    [flushPending, pushHistoryEntry, value],
  );

  const undo = useCallback(() => {
    flushPending();
    const previous = stackRef.current.undo(lastSnapshotRef.current);
    if (previous === null) return;
    lastSnapshotRef.current = previous;
    setInternalValue(previous);
    sync();
  }, [flushPending, sync]);

  const redo = useCallback(() => {
    flushPending();
    const next = stackRef.current.redo(lastSnapshotRef.current);
    if (next === null) return;
    lastSnapshotRef.current = next;
    setInternalValue(next);
    sync();
  }, [flushPending, sync]);

  const reset = useCallback(
    (next) => {
      flushPending();
      stackRef.current.clear();
      lastSnapshotRef.current = next;
      setInternalValue(next);
      sync();
    },
    [flushPending, sync],
  );

  useEffect(() => () => flushPending(), [flushPending]);

  return {
    value,
    setValue,
    replace,
    reset,
    commit,
    undo,
    redo,
    canUndo: historyState.canUndo,
    canRedo: historyState.canRedo,
    _historyVersion: historyState.version,
  };
}
