import { useCallback, useEffect, useRef, useState } from "react";

import { FillyPreference, fillyPreferenceApi } from "@/lib/quota-api";

interface UseFillyPreferenceReturn {
  enabled: boolean;
  facilityAvailable: boolean;
  tnc: string | undefined;
  tncAccepted: boolean;
  isLoading: boolean;
  error: string | null;
  /** Enable (records TnC consent server-side) or disable filly. */
  setEnabled: (enabled: boolean) => Promise<void>;
  refetch: () => void;
}

/** Per-user filly opt-in (set from the profile page). */
export function useFillyPreference(): UseFillyPreferenceReturn {
  const [data, setData] = useState<FillyPreference | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const fetchPreference = useCallback(() => {
    const seq = ++requestSeq.current;
    setIsLoading(true);
    fillyPreferenceApi
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
    const response = await fillyPreferenceApi.set(enabled);
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
