export type AdminFailure = { ok: false; status: number; message: string; fieldErrors?: Record<string, string> };
export const fail = (status: number, message: string, fieldErrors?: Record<string, string>): AdminFailure => ({ ok: false, status, message, fieldErrors });
