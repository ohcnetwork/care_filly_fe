import { useCallback, useEffect, useRef, useState } from "react";

import { ScribePreference, scribePreferenceApi } from "@/lib/quota-api";

interface UseScribePreferenceReturn {
  enabled: boolean;
  facilityAvailable: boolean;
  tnc: string | undefined;
  tncAccepted: boolean;
  isLoading: boolean;
  error: string | null;
  /** Enable (records TnC consent server-side) or disable scribe. */
  setEnabled: (enabled: boolean) => Promise<void>;
  refetch: () => void;
}

/** Per-user scribe opt-in (set from the profile page). */
export function useScribePreference(): UseScribePreferenceReturn {
  const [data, setData] = useState<ScribePreference | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const fetchPreference = useCallback(() => {
    const seq = ++requestSeq.current;
    setIsLoading(true);
    scribePreferenceApi
      .get()
      .then((response) => {
        if (seq !== requestSeq.current) return;
        setData(response);
        setError(null);
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current) return;
        setError(
          err instanceof Error ? err.message : "Failed to load preference",
        );
      })
      .finally(() => {
        if (seq === requestSeq.current) setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchPreference();
  }, [fetchPreference]);

  const setEnabled = useCallback(async (enabled: boolean) => {
    const response = await scribePreferenceApi.set(enabled);
    requestSeq.current++;
    setData(response);
  }, []);

  return {
    enabled: Boolean(data?.enabled && data?.tnc_accepted),
    facilityAvailable: Boolean(data?.facility_available),
    tnc: data?.tnc,
    tncAccepted: Boolean(data?.tnc_accepted),
    isLoading,
    error,
    setEnabled,
    refetch: fetchPreference,
  };
}
