import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** サーバー描画と水和の間は false、水和後は true。タイムゾーン等、サーバーとクライアントで変わる値を水和後に切り替えるのに使う。 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
