import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { HttpMethod, request } from "@/lib/request";

/**
 * Per-user Filly settings, stored on CARE core's `User.preferences` under the
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
const FILLY_PREFERENCE_KEY = [CURRENT_USER_KEY, "filly"] as const;
const FILLY_MUTATION_KEY = ["filly-preferences"] as const;

export type FieldFillDelayMs = 0 | 200 | 500;

interface FillyPreference {
  enabled: boolean;
  field_fill_delay_ms: FieldFillDelayMs;
}

function readFillyPreference(
  user: CurrentUserResponse | undefined,
): Record<string, unknown> {
  const value = user?.preferences?.filly;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** CARE requires a `version` on every preference write; it is discarded. */
const PREFERENCE_VERSION = "0.0.1";

interface CurrentUserResponse {
  preferences?: Record<string, unknown>;
}

interface UseFillyPreferenceReturn {
  enabled: boolean;
  fieldFillDelayMs: FieldFillDelayMs;
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
  setFieldFillDelayMs: (delay: FieldFillDelayMs) => Promise<void>;
}

export function useFillyPreference(): UseFillyPreferenceReturn {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: FILLY_PREFERENCE_KEY,
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
    mutationKey: FILLY_MUTATION_KEY,
    scope: { id: "filly-preferences" },
    mutationFn: (updates: Partial<FillyPreference>) => {
      const current = readFillyPreference(
        queryClient.getQueryData<CurrentUserResponse>(FILLY_PREFERENCE_KEY),
      );
      return request(
        {
          path: "/api/v1/users/set_preferences/",
          method: HttpMethod.POST,
          TResponse: null,
        },
        {
          body: {
            preference: "filly",
            version: PREFERENCE_VERSION,
            value: { ...current, ...updates },
          },
        },
      );
    },
    // The response has no body — re-read the user instead of trusting it.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [CURRENT_USER_KEY] }),
  });

  const filly = readFillyPreference(data);
  const delay = filly.field_fill_delay_ms;

  return {
    enabled: Boolean(filly.enabled),
    fieldFillDelayMs: delay === 0 || delay === 200 ? delay : 500,
    isLoading,
    error: error instanceof Error ? error.message : null,
    isSaving: mutation.isPending,
    setEnabled: async (enabled: boolean) => {
      await mutation.mutateAsync({ enabled });
    },
    setFieldFillDelayMs: async (delay: FieldFillDelayMs) => {
      await mutation.mutateAsync({ field_fill_delay_ms: delay });
    },
  };
}
