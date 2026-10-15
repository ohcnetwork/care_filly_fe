const apiUrlMap: Record<string, string> = import.meta.env.REACT_CARE_URL_MAP
  ? JSON.parse(import.meta.env.REACT_CARE_URL_MAP)
  : {};

declare global {
  interface Window {
    CARE_API_URL: string;
  }
}

const resolveCareApiUrl = (): string => {
  if (typeof window === "undefined") return "";

  const mappedUrl = apiUrlMap[window.location.origin];
  const fallbackUrl = import.meta.env.REACT_CARE_API_URL ?? "";
  const careApiUrl = window.CARE_API_URL || mappedUrl || fallbackUrl;
  window.CARE_API_URL = careApiUrl;

  return careApiUrl;
};

export const CARE_API_URL = resolveCareApiUrl();
