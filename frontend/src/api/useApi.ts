import { useCallback, useEffect, useRef, useState } from "react";
import { api, cleanParams, errorMessage } from "./client";

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  status: number | null;
  reload: () => void;
}

/** GET a resource. Pass null as the URL to skip. A newer request always wins over an older one. */
export function useApi<T>(url: string | null, params: Record<string, unknown> = {}): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(url !== null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);
  const key = JSON.stringify(cleanParams(params));

  useEffect(() => {
    if (url === null) {
      setLoading(false);
      return;
    }
    const request = ++latest.current;
    setLoading(true);
    api
      .get<T>(url, { params: JSON.parse(key) })
      .then((response) => {
        if (request !== latest.current) return;
        setData(response.data);
        setError(null);
        setStatus(response.status);
      })
      .catch((failure) => {
        if (request !== latest.current) return;
        setData(null);
        setError(errorMessage(failure));
        setStatus(failure?.response?.status ?? null);
      })
      .finally(() => {
        if (request === latest.current) setLoading(false);
      });
  }, [url, key, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { data, loading, error, status, reload };
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
