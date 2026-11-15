import { useLocation } from "react-router";
import { buildLoginHref } from "@/lib/return-to";

/** ページ内のログイン導線用。ログイン後に現在地へ戻れる `/login?returnTo=…` を返す。 */
export function useLoginHref(): string {
  const { pathname, search } = useLocation();
  return buildLoginHref(pathname, search);
}
