// /keybindings/stats は /keybindings?view=stats に統合済み（v1.5.0）。
// 互換のためルート自体は残し、ここでは 301 リダイレクトのみを行う。
import { redirect } from "react-router";
import type { Route } from "./+types/keybindings-stats";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const extra = url.search ? `&${url.search.slice(1)}` : "";
  return redirect(`/keybindings?view=stats${extra}`, 301);
}

export default function KeybindingsStatsRedirect() {
  return null;
}
