import { errorCodeOf } from "../../../shared/errors";
export const WINDOW_LIST_EVENT = "sshos-open-window-list";
export function reportWindowLimit(error: unknown): boolean {
  if (errorCodeOf(error) !== "WINDOW_LIMIT") return false;
  window.dispatchEvent(new Event(WINDOW_LIST_EVENT));
  return true;
}
