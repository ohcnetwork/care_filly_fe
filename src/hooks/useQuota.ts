import { useCallback, useEffect, useRef, useState } from "react";

import { FillyQuota, MyQuotaResponse, quotaApi } from "@/lib/quota-api";

interface UseQuotaReturn {
  quotas: FillyQuota[] | undefined;
  /** Facility-level quota row (user=null), when present. */
  facilityQuota: FillyQuota | undefined;
  /** Current user's quota row, when present. */
  userQuota: FillyQuota | undefined;
  tnc: string | undefined;
  tncAccepted: boolean;
  /** True when filly should be offered at all for this facility. */
  fillyEnabled: boolean;
  /** Set when the facility or user has run out of tokens this month. */
  quotaExceeded: "facility" | "user" | null;
  isLoading: boolean;
  error: string | null;
  acceptTnc: () => Promise<void>;
  refetch: () => void;
}

/**
 * Fetches the caller's filly quota for a facility (mirrors
 * care_filly_fe's useQuota).
 */
export function useQuota(facilityId: string | null): UseQuotaReturn {
  const [data, setData] = useState<MyQuotaResponse | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(facilityId));
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const fetchQuota = useCallback(() => {
    if (!facilityId) {
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
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current) return;
        setError(err instanceof Error ? err.message : "Failed to load quota");
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

  const fillyEnabled = Boolean(facilityQuota?.allow_filly);

  let quotaExceeded: "facility" | "user" | null = null;
  if (facilityQuota && facilityQuota.used >= facilityQuota.tokens) {
    quotaExceeded = "facility";
  } else if (userQuota && userQuota.used >= userQuota.tokens) {
    quotaExceeded = "user";
  }

  return {
    quotas: data?.quotas,
    facilityQuota,
    userQuota,
    tnc: data?.tnc,
    tncAccepted: Boolean(data?.tnc_accepted),
    fillyEnabled,
    quotaExceeded,
    isLoading,
    error,
    acceptTnc,
    refetch: fetchQuota,
  };
}
