/**
 * ナビ項目 href のうち、現在の pathname に対する「現在地」を返す。
 * 前方一致（`/guides` は `/guides/xxx` でも現在地）。複数一致する場合は最も長い href だけを返す。
 * `/` は完全一致のみ（全ページに一致してしまうため）。
 */
export function findActiveNavHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    const matches =
      pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
    if (matches && (best === null || href.length > best.length)) best = href;
  }
  return best;
}
