import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_DURATION_MS = 5000;

let snackbarIdSeed = 0;
const nextSnackbarId = () => {
  snackbarIdSeed = (snackbarIdSeed + 1) % Number.MAX_SAFE_INTEGER;
  return `snackbar-${Date.now()}-${snackbarIdSeed}`;
};

export function useSnackbar() {
  const [items, setItems] = useState([]);
  const timersRef = useRef(new Map());

  const dismiss = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(({ message, actionLabel, onAction, duration }) => {
    const id = nextSnackbarId();
    const lifespan = typeof duration === "number" ? duration : DEFAULT_DURATION_MS;
    setItems((current) => [...current, { id, message, actionLabel, onAction }]);
    if (typeof window !== "undefined" && lifespan > 0) {
      const timer = window.setTimeout(() => {
        timersRef.current.delete(id);
        setItems((current) => current.filter((item) => item.id !== id));
      }, lifespan);
      timersRef.current.set(id, timer);
    }
    return id;
  }, []);

  const trigger = useCallback(
    (id) => {
      const target = items.find((item) => item.id === id);
      if (!target) return;
      if (typeof target.onAction === "function") {
        target.onAction();
      }
      dismiss(id);
    },
    [items, dismiss],
  );

  useEffect(
    () => () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    },
    [],
  );

  return { items, push, dismiss, trigger };
}
