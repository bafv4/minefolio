import { redirect } from "react-router";
import type { Route } from "./+types/index";

export function loader(_: Route.LoaderArgs) {
  // /me へのアクセスは /me/edit にリダイレクト
  return redirect("/me/edit");
}
