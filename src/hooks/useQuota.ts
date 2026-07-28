import { useCallback, useEffect, useRef, useState } from "react";

import {
  MyQuotaResponse,
  QuotaApiError,
  ScribeQuota,
  quotaApi,
} from "@/lib/quota-api";
import { SCRIBE_BE_IS_OVERRIDE } from "@/lib/scribe-be";

interface UseQuotaReturn {
  quotas: ScribeQuota[] | undefined;
  /** Facility-level quota row (user=null), when present. */
  facilityQuota: ScribeQuota | undefined;
  /** Current user's quota row, when present. */
  userQuota: ScribeQuota | undefined;
  tnc: string | undefined;
  tncAccepted: boolean;
  /** True when scribe should be offered at all for this facility. */
  scribeEnabled: boolean;
  /** Set when the facility or user has run out of tokens this month. */
  quotaExceeded: "facility" | "user" | null;
  isLoading: boolean;
  error: string | null;
  acceptTnc: () => Promise<void>;
  refetch: () => void;
}

/**
 * Fetches the caller's scribe quota for a facility (mirrors
 * care_scribe_fe's useQuota). When the backend has no quota endpoints
 * (standalone override deployments), scribe stays enabled and
 * enforcement is left to the backend.
 */
export function useQuota(facilityId: string | null): UseQuotaReturn {
  const [data, setData] = useState<MyQuotaResponse | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(facilityId));
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const requestSeq = useRef(0);

  const fetchQuota = useCallback(() => {
    if (!facilityId || SCRIBE_BE_IS_OVERRIDE) {
      setIsLoading(false);
      return;
    }
    const seq = ++requestSeq.current;
    setIsLoading(true);
    quotaApi
      .myQuota(facilityId)
      .then((response) => {
        if (seq !== requestSeq.current) return;
        setData(response);
        setError(null);
        setUnavailable(false);
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current) return;
        if (err instanceof QuotaApiError && err.status === 404) {
          // Backend without quota support — don't brick the plugin.
          setUnavailable(true);
          setError(null);
        } else {
          setError(err instanceof Error ? err.message : "Failed to load quota");
        }
      })
      .finally(() => {
        if (seq === requestSeq.current) setIsLoading(false);
      });
  }, [facilityId]);

  useEffect(() => {
    fetchQuota();
  }, [fetchQuota]);

  const acceptTnc = useCallback(async () => {
    if (!facilityId) return;
    await quotaApi.acceptTnc(facilityId);
    fetchQuota();
  }, [facilityId, fetchQuota]);

  const facilityQuota = data?.quotas.find((q) => !q.user);
  const userQuota = data?.quotas.find((q) => q.user);

  const quotaBypassed = SCRIBE_BE_IS_OVERRIDE || unavailable;
  const scribeEnabled = quotaBypassed || Boolean(facilityQuota?.allow_scribe);

  let quotaExceeded: "facility" | "user" | null = null;
  if (!quotaBypassed) {
    if (facilityQuota && facilityQuota.used >= facilityQuota.tokens) {
      quotaExceeded = "facility";
    } else if (userQuota && userQuota.used >= userQuota.tokens) {
      quotaExceeded = "user";
    }
  }

  return {
    quotas: data?.quotas,
    facilityQuota,
    userQuota,
    tnc: data?.tnc,
    tncAccepted: quotaBypassed || Boolean(data?.tnc_accepted),
    scribeEnabled,
    quotaExceeded,
    isLoading,
    error,
    acceptTnc,
    refetch: fetchQuota,
  };
}
