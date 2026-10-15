declare global {
  interface Window {
    CARE_API_URL: string;
  }
}

const resolveCareApiUrl = (): string => {
  if (typeof window === "undefined") return "";

  const fallbackUrl = import.meta.env.REACT_CARE_API_URL ?? "";
  const careApiUrl =
    window.CARE_API_URL || fallbackUrl || window.location.origin;
  window.CARE_API_URL = careApiUrl;

  return careApiUrl;
};

export const CARE_API_URL = resolveCareApiUrl();
