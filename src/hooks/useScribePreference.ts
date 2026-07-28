import { useCallback, useEffect, useRef, useState } from "react";

import {
  QuotaApiError,
  ScribePreference,
  scribePreferenceApi,
} from "@/lib/quota-api";
import { SCRIBE_BE_IS_OVERRIDE } from "@/lib/scribe-be";

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

/**
 * Per-user scribe opt-in (set from the profile page). When the backend
 * has no preference endpoint (standalone override deployments), scribe
 * stays enabled.
 */
export function useScribePreference(): UseScribePreferenceReturn {
  const [data, setData] = useState<ScribePreference | null>(null);
  const [isLoading, setIsLoading] = useState(!SCRIBE_BE_IS_OVERRIDE);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const requestSeq = useRef(0);

  const fetchPreference = useCallback(() => {
    if (SCRIBE_BE_IS_OVERRIDE) {
      setIsLoading(false);
      return;
    }
    const seq = ++requestSeq.current;
    setIsLoading(true);
    scribePreferenceApi
      .get()
      .then((response) => {
        if (seq !== requestSeq.current) return;
        setData(response);
        setError(null);
        setUnavailable(false);
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current) return;
        if (err instanceof QuotaApiError && err.status === 404) {
          // Backend without preference support — don't brick the plugin.
          setUnavailable(true);
          setError(null);
        } else {
          setError(
            err instanceof Error ? err.message : "Failed to load preference",
          );
        }
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

  const bypassed = SCRIBE_BE_IS_OVERRIDE || unavailable;

  return {
    enabled: bypassed || Boolean(data?.enabled && data?.tnc_accepted),
    facilityAvailable: bypassed || Boolean(data?.facility_available),
    tnc: data?.tnc,
    tncAccepted: bypassed || Boolean(data?.tnc_accepted),
    isLoading,
    error,
    setEnabled,
    refetch: fetchPreference,
  };
}
