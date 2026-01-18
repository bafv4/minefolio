import { redirect } from "react-router";
import type { Route } from "./+types/browse";

// /browse へのアクセスは / へリダイレクト（ホームに統合）
export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const searchParams = url.searchParams.toString();
  const redirectUrl = searchParams ? `/?${searchParams}` : "/";
  return redirect(redirectUrl);
}
