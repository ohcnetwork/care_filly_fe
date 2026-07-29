import { MP3_MIME } from "./encoder";
import { UploadError } from "./errors";
import type { SessionUploadInfo } from "./types";

const KEY_FIELD = "key";
const FILENAME_TOKEN = "${filename}";
const CONTENT_TYPE_FIELD = "Content-Type";

export interface UploadResult {
  fileName: string;
  status: number;
  headers: Record<string, string>;
}

/**
 * Upload a single audio blob to a server-selected storage backend using the
 * presigned descriptor returned by create-session.
 *
 * Only the AWS S3 presigned-POST provider is supported (the care_filly default).
 * These requests intentionally omit credentials and the Authorization header —
 * the presigned form fields carry their own authorisation.
 */
export async function uploadToStorage(
  fileName: string,
  blob: Blob,
  upload: SessionUploadInfo,
): Promise<UploadResult> {
  const uploadData = upload?.uploadData;
  if (!uploadData?.url || !uploadData.fields) {
    throw new UploadError(
      "Invalid AWS upload payload in session response (missing uploadData.url/fields)",
      [fileName],
    );
  }

  const form = new FormData();
  let hasContentType = false;
  for (const [key, value] of Object.entries(uploadData.fields)) {
    const resolved =
      key === KEY_FIELD ? value.split(FILENAME_TOKEN).join(fileName) : value;
    if (key === CONTENT_TYPE_FIELD) hasContentType = true;
    form.append(key, resolved);
  }
  if (!hasContentType) {
    const type = blob.type;
    form.append(
      CONTENT_TYPE_FIELD,
      type && type.startsWith("audio/") ? type : MP3_MIME,
    );
  }
  // File must be appended last for S3 presigned POSTs.
  form.append("file", blob, fileName);

  let response: Response;
  try {
    response = await fetch(uploadData.url, {
      method: "POST",
      body: form,
      credentials: "omit",
    });
  } catch (err) {
    throw new UploadError(
      err instanceof Error ? err.message : "Upload request failed",
      [fileName],
    );
  }

  if (!response.ok) {
    throw new UploadError(
      `Upload failed: ${response.status} ${response.statusText}`,
      [fileName],
    );
  }

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return { fileName, status: response.status, headers };
}
