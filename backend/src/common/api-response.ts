// Trimmed from uplive-prep's boilerplate-kit ResponseService/api-response.dto:
// this app has no pagination and no auth, so only the two shapes actually
// used survive the port.
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  message: string;
  code: string;
  details?: unknown;
}

export function ok<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}
