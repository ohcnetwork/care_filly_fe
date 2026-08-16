import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { HttpMethod, request } from "@/lib/request";

/**
 * Per-user Filly opt-in, stored on CARE core's `User.preferences` under the
 * `filly` key. There is no plugin-side model or endpoint — core owns both
 * sides:
 *
 *   read  GET  /api/v1/users/getcurrentuser/   (the only endpoint that
 *                                               serializes `preferences`)
 *   write POST /api/v1/users/set_preferences/  (201, empty body)
 *
 * An absent key means off, so Filly is opt-in by default.
 *
 * The query key is prefixed `currentUser` to match the CARE host's own
 * `["currentUser", accessToken]`, so one invalidation refreshes both the
 * host's copy of the user and ours.
 */

const CURRENT_USER_KEY = "currentUser";

/** CARE requires a `version` on every preference write; it is discarded. */
const PREFERENCE_VERSION = "0.0.1";

interface CurrentUserResponse {
  preferences?: Record<string, unknown>;
}

interface UseFillyPreferenceReturn {
  enabled: boolean;
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
}

export function useFillyPreference(): UseFillyPreferenceReturn {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: [CURRENT_USER_KEY, "filly"],
    queryFn: ({ signal }) =>
      request(
        {
          path: "/api/v1/users/getcurrentuser/",
          method: HttpMethod.GET,
          TResponse: {} as CurrentUserResponse,
        },
        { signal },
      ),
  });

  const mutation = useMutation({
    mutationFn: (enabled: boolean) =>
      request(
        {
          path: "/api/v1/users/set_preferences/",
          method: HttpMethod.POST,
          TResponse: null,
        },
        {
          body: {
            preference: "filly",
            version: PREFERENCE_VERSION,
            value: { enabled },
          },
        },
      ),
    // The response has no body — re-read the user instead of trusting it.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [CURRENT_USER_KEY] }),
  });

  const filly = (data?.preferences?.filly ?? {}) as { enabled?: boolean };

  return {
    enabled: Boolean(filly.enabled),
    isLoading,
    error: error instanceof Error ? error.message : null,
    isSaving: mutation.isPending,
    setEnabled: async (enabled: boolean) => {
      await mutation.mutateAsync(enabled);
    },
  };
}
