// i18n configuration for Minefolio
// Supports Japanese and English

export type Locale = "ja" | "en";

export const defaultLocale: Locale = "ja";

export const supportedLocales: Record<Locale, { name: string; nativeName: string }> = {
  ja: { name: "Japanese", nativeName: "日本語" },
  en: { name: "English", nativeName: "English" },
};

// Translation keys organized by feature/page
export const translations = {
  ja: {
    // Common
    common: {
      loading: "読み込み中...",
      error: "エラーが発生しました",
      save: "保存",
      cancel: "キャンセル",
      delete: "削除",
      edit: "編集",
      add: "追加",
      search: "検索",
      searchPlaceholder: "MCIDで検索...",
      sortBy: "並び替え",
      recent: "新着順",
      nameAsc: "名前順 (A-Z)",
      mostViewed: "閲覧数順",
      previous: "前へ",
      next: "次へ",
      views: "閲覧",
      joined: "登録",
      comingSoon: "近日公開",
      checkBackLater: "後日またお確かめください",
      noResults: "見つかりませんでした",
      clearSearch: "検索をクリア",
      tryDifferentSearch: "別の検索ワードをお試しください",
      or: "または",
    },

    // Navigation
    nav: {
      home: "ホーム",
      browse: "プレイヤー一覧",
      keybindings: "操作設定",
      rankings: "ランキング",
      stats: "統計",
      login: "ログイン",
      logout: "ログアウト",
      myProfile: "マイプロフィール",
      settings: "設定",
      toggleMenu: "メニューを開閉",
    },

    // Footer
    footer: {
      privacy: "プライバシー",
      terms: "利用規約",
    },

    // Home page
    home: {
      title: "Minecraft Speedrunner Portfolio",
      subtitle:
        "スピードランナーを探して、キー配置や自己ベストなどを確認しましょう。",
      getStarted: "始める",
      browsePlayers: "プレイヤーを探す",
      players: "プレイヤー",
      noPlayersFound: "プレイヤーが見つかりません",
    },

    // Browse page
    browse: {
      title: "プレイヤー一覧",
      description: "Minecraftスピードランナーを探して、ポートフォリオをチェック。",
      playersFound: "{count}人のプレイヤー",
    },

    // Rankings page
    rankings: {
      title: "ランキング",
      description: "スピードランのランキングとリーダーボードを表示。",
      comingSoonTitle: "近日公開",
      comingSoonDescription:
        "Speedrun.comやMCSR Rankedとの連携は今後のアップデートで対応予定です。",
    },

    // Stats page
    stats: {
      title: "プラットフォーム統計",
      description: "Minefolioの利用統計とメトリクス。",
      totalPlayers: "総プレイヤー数",
      totalPlayersDesc: "登録スピードランナー",
      totalViews: "総閲覧数",
      totalViewsDesc: "全プロフィールの合計",
      moreStatsComing: "詳細な統計は近日公開",
      moreStatsDesc:
        "詳細な分析、トレンド、コミュニティインサイトは今後のアップデートで提供予定です。",
    },

    // Keybindings list page
    keybindingsList: {
      title: "操作設定一覧",
      description: "スピードランナーの操作設定・キー配置を一覧で確認できます。",
      playersFound: "{count}人のプレイヤー",
      layout: "{layout}配列",
    },

    // Login page
    login: {
      title: "Minefolio",
      description: "スピードランナーポートフォリオを管理するにはサインインしてください",
      continueWithDiscord: "Discordでログイン",
      agreementPrefix: "サインインすることで、",
      termsOfService: "利用規約",
      and: "と",
      privacyPolicy: "プライバシーポリシー",
      agreementSuffix: "に同意したものとみなされます。",
    },

    // Onboarding page
    onboarding: {
      title: "Minefolioへようこそ！",
      stepVerify: "プロフィールを設定しましょう",
      stepConfirm: "もう少しです！プロフィールを確認してください。",
      connectedViaDiscord: "Discord経由で接続済み",
      mcidLabel: "Minecraft ID (MCID)",
      mcidPlaceholder: "例: Steve",
      mcidHint: "MCIDはMojang APIで検証されます",
      verifyAndContinue: "検証して続行",
      verifying: "検証中...",
      verified: "Minecraft IDの検証に成功しました！",
      foundLegacyData: "MCSRer Hotkeysのデータが見つかりました",
      legacyDataHint: "キー配置と設定をインポートできます",
      importData: "データをインポート",
      startFresh: "新規で始める",
      completeSetup: "セットアップを完了",
      creatingProfile: "プロフィールを作成中...",
      errorMcidRequired: "Minecraft IDを入力してください",
      errorMcidLength: "Minecraft IDは3〜16文字である必要があります",
      errorMcidTaken: "このMinecraft IDは既に登録されています",
      errorMcidNotFound: "Minecraft IDが見つかりません。確認してもう一度お試しください。",
      errorVerifyFailed: "Minecraft IDの検証に失敗しました。もう一度お試しください。",
      errorInvalidRequest: "無効なリクエストです。最初からやり直してください。",
    },

    // Player profile page
    profile: {
      notFoundTitle: "プレイヤーが見つかりません",
      editProfile: "プロフィールを編集",
      featuredRecords: "注目の記録",
      keybindings: "キー配置",
      records: "記録",
      devices: "デバイス",
      settings: "設定",
      noKeybindings: "キー配置が未設定",
      noKeybindingsDesc: "このプレイヤーはまだキー配置を設定していません。",
      noRecords: "記録なし",
      noRecordsDesc: "このプレイヤーはまだ記録を追加していません。",
      noDeviceInfo: "デバイス情報なし",
      noDeviceInfoDesc: "このプレイヤーはまだデバイス設定をしていません。",
      noSettings: "設定なし",
      noSettingsDesc: "このプレイヤーはまだゲーム内設定をしていません。",
      watchVideo: "動画を見る",
      goal: "目標",
      pb: "PB",
      keyboard: "キーボード",
      mouse: "マウス",
      model: "モデル",
      layout: "レイアウト",
      dpi: "DPI",
      sensitivity: "ゲーム感度",
      noKeyboardInfo: "キーボード情報なし",
      noMouseInfo: "マウス情報なし",
      inGameSettings: "ゲーム内設定",
      toggleSprint: "スプリント切替",
      toggleSneak: "スニーク切替",
      autoJump: "自動ジャンプ",
      rawInput: "生入力",
      mouseAccel: "マウス加速",
      gameLanguage: "ゲーム言語",
      on: "オン",
      off: "オフ",
      // Category labels
      movement: "移動",
      combat: "戦闘",
      inventory: "インベントリ",
      ui: "UI",
    },

    // Me (Dashboard) pages
    me: {
      overview: "概要",
      editProfile: "プロフィール編集",
      records: "記録",
      socialLinks: "ソーシャルリンク",
      keybindings: "キー配置",
      devices: "デバイス",
      itemLayouts: "アイテム配置",
      searchCraft: "サーチクラフト",
    },

    // Error pages
    errors: {
      oops: "おっと！",
      unexpectedError: "予期しないエラーが発生しました。",
      notFound: "404",
      pageNotFound: "お探しのページが見つかりませんでした。",
    },
  },
  en: {
    // Common
    common: {
      loading: "Loading...",
      error: "An error occurred",
      save: "Save",
      cancel: "Cancel",
      delete: "Delete",
      edit: "Edit",
      add: "Add",
      search: "Search",
      searchPlaceholder: "Search by MCID...",
      sortBy: "Sort by",
      recent: "Recent",
      nameAsc: "Name (A-Z)",
      mostViewed: "Most Viewed",
      previous: "Previous",
      next: "Next",
      views: "views",
      joined: "Joined",
      comingSoon: "Coming Soon",
      checkBackLater: "Check back later for updates",
      noResults: "No results found",
      clearSearch: "Clear search",
      tryDifferentSearch: "Try a different search term",
      or: "or",
    },

    // Navigation
    nav: {
      home: "Home",
      browse: "Browse Players",
      keybindings: "Keybindings",
      rankings: "Rankings",
      stats: "Stats",
      login: "Log in",
      logout: "Log out",
      myProfile: "My Profile",
      settings: "Settings",
      toggleMenu: "Toggle menu",
    },

    // Footer
    footer: {
      privacy: "Privacy",
      terms: "Terms",
    },

    // Home page
    home: {
      title: "Minecraft Speedrunner Portfolio",
      subtitle: "Discover speedrunners and explore their keybindings, personal bests, and more.",
      getStarted: "Get Started",
      browsePlayers: "Browse Players",
      players: "Players",
      noPlayersFound: "No players found",
    },

    // Browse page
    browse: {
      title: "Browse Players",
      description: "Discover Minecraft speedrunners and check out their portfolios.",
      playersFound: "{count} players found",
    },

    // Rankings page
    rankings: {
      title: "Rankings",
      description: "View speedrun rankings and leaderboards.",
      comingSoonTitle: "Coming Soon",
      comingSoonDescription:
        "Integration with Speedrun.com and MCSR Ranked will be available in future updates.",
    },

    // Stats page
    stats: {
      title: "Platform Statistics",
      description: "Explore Minefolio usage statistics and metrics.",
      totalPlayers: "Total Players",
      totalPlayersDesc: "Registered speedrunners",
      totalViews: "Total Views",
      totalViewsDesc: "Across all profiles",
      moreStatsComing: "More Stats Coming Soon",
      moreStatsDesc:
        "Detailed analytics, trends, and community insights will be available in future updates.",
    },

    // Keybindings list page
    keybindingsList: {
      title: "Keybindings Directory",
      description: "Browse keybindings from top Minecraft speedrunners.",
      playersWithKeybindings: "{count} players",
      noKeybindingsFound: "No keybindings found",
    },

    // Compare page
    compare: {
      title: "Compare Players",
      description: "Side-by-side comparison of player stats and configurations.",
      addPlayer: "Add Player",
      selectPlayers: "Select players to compare",
      player: "Player",
      noPlayersSelected: "No players selected",
      selectAtLeast: "Select at least two players",
      clearAll: "Clear All",
    },

    // Favorites page
    favorites: {
      title: "Favorites",
      description: "Your bookmarked players",
      empty: "No favorites yet",
      addFavorites: "Add players to favorites to see them here",
      loginToSync: "Log in to sync favorites across devices",
    },

    // Profile tabs
    profileTabs: {
      keybindings: "Keybindings",
      stats: "Stats",
      devices: "Devices",
      itemLayouts: "Item Layouts",
      searchCraft: "Search Craft",
    },

    // Error pages
    errors: {
      oops: "Oops!",
      unexpectedError: "An unexpected error occurred.",
      notFound: "404",
      pageNotFound: "The page you're looking for doesn't exist.",
    },
  },
} as const;

// Type-safe translation function
export type TranslationKey = keyof typeof translations.ja;

/**
 * ロケールを取得（Cookieまたはブラウザ設定から）
 */
export function getLocaleFromRequest(request?: Request): Locale {
  if (!request) return defaultLocale;

  // Cookieから取得
  const cookieHeader = request.headers.get("Cookie");
  if (cookieHeader) {
    const match = cookieHeader.match(/minefolio_locale=([^;]+)/);
    if (match && (match[1] === "ja" || match[1] === "en")) {
      return match[1] as Locale;
    }
  }

  // Accept-Languageヘッダーから取得
  const acceptLanguage = request.headers.get("Accept-Language");
  if (acceptLanguage) {
    if (acceptLanguage.includes("ja")) return "ja";
    if (acceptLanguage.includes("en")) return "en";
  }

  return defaultLocale;
}

/**
 * 翻訳関数（ロケール指定可能）
 */
export function t<
  K extends keyof typeof translations.ja,
  SK extends keyof (typeof translations.ja)[K],
>(
  category: K,
  key: SK,
  params?: Record<string, string | number>,
  locale: Locale = defaultLocale
): string {
  const localeTranslations = translations[locale];
  const categoryTranslations = localeTranslations[category as keyof typeof localeTranslations];
  const translation = categoryTranslations[key as keyof typeof categoryTranslations] as string;

  if (!params) return translation;

  // Replace placeholders like {count} with actual values
  return Object.entries(params).reduce(
    (str, [param, value]) => str.replace(`{${param}}`, String(value)),
    translation
  );
}

/**
 * Hook-style getter for components
 */
export function useTranslation(locale: Locale = defaultLocale) {
  return {
    t: <K extends keyof typeof translations.ja, SK extends keyof (typeof translations.ja)[K]>(
      category: K,
      key: SK,
      params?: Record<string, string | number>
    ) => t(category, key, params, locale),
    locale,
  };
}

/**
 * ロケール切り替え用のCookie値を生成
 */
export function createLocaleCookieValue(locale: Locale): string {
  return `minefolio_locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
