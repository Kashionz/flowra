import { useCallback, useEffect, useRef, useState } from "react";

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
 */
export function useUndoableState(initialValue) {
  const [value, setInternalValue] = useState(initialValue);
  const [pastCount, setPastCount] = useState(0);
  const [futureCount, setFutureCount] = useState(0);

  const pastRef = useRef([]);
  const futureRef = useRef([]);
  // Capture the resolved initial value (useState already invoked the
  // factory if `initialValue` was a function), so the ref never holds
  // a lazy initializer by mistake.
  const lastSnapshotRef = useRef(value);
  const coalesceTimerRef = useRef(null);

  const sync = useCallback(() => {
    setPastCount(pastRef.current.length);
    setFutureCount(futureRef.current.length);
  }, []);

  const flushPending = useCallback(() => {
    if (coalesceTimerRef.current) {
      clearTimeout(coalesceTimerRef.current);
      coalesceTimerRef.current = null;
    }
  }, []);

  const pushHistoryEntry = useCallback(() => {
    if (lastSnapshotRef.current === undefined) return;
    pastRef.current.push(lastSnapshotRef.current);
    while (pastRef.current.length > HISTORY_LIMIT) {
      pastRef.current.shift();
    }
    futureRef.current = [];
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

  // Track the latest committed value so the coalesced timer can capture it.
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
      // Used for wholesale replacements (template load, import, redo from
      // an external trigger) where we want the new value to start fresh
      // history but still be reversible.
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
    if (pastRef.current.length === 0) return;
    const previous = pastRef.current.pop();
    futureRef.current.push(lastSnapshotRef.current);
    while (futureRef.current.length > HISTORY_LIMIT) {
      futureRef.current.shift();
    }
    lastSnapshotRef.current = previous;
    setInternalValue(previous);
    sync();
  }, [flushPending, sync]);

  const redo = useCallback(() => {
    flushPending();
    if (futureRef.current.length === 0) return;
    const next = futureRef.current.pop();
    pastRef.current.push(lastSnapshotRef.current);
    while (pastRef.current.length > HISTORY_LIMIT) {
      pastRef.current.shift();
    }
    lastSnapshotRef.current = next;
    setInternalValue(next);
    sync();
  }, [flushPending, sync]);

  const reset = useCallback(
    (next) => {
      flushPending();
      pastRef.current = [];
      futureRef.current = [];
      lastSnapshotRef.current = next;
      setInternalValue(next);
      sync();
    },
    [flushPending, sync],
  );

  // Cleanup on unmount.
  useEffect(() => () => flushPending(), [flushPending]);

  return {
    value,
    setValue,
    replace,
    reset,
    commit,
    undo,
    redo,
    canUndo: pastCount > 0,
    canRedo: futureCount > 0,
  };
}
