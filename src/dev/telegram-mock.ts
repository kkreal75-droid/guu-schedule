// Эмулятор клиента Telegram для локальной разработки. В production-сборку не попадает
// (вызывается только под import.meta.env.DEV).
//
//   http://localhost:5173/?tg              — «как в Telegram», тёмная тема
//   http://localhost:5173/?tg=light        — светлая тема
//   http://localhost:5173/?tg&uid=7&name=… — другой тестовый пользователь
//
// Приложение получает тестового пользователя и цвета темы через те же параметры запуска,
// что передаёт настоящий Telegram, а CloudStorage работает поверх localStorage (ключ mock_cloud).
// initData подписан фиктивным токеном из bot/.dev.vars — его принимает локальный `wrangler dev`
// (VITE_BOT_URL=http://127.0.0.1:8787), настоящий бот — нет.

const DEV_BOT_TOKEN: string = import.meta.env.VITE_DEV_BOT_TOKEN ?? '123456:LOCAL-TEST-TOKEN'

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

async function hmac(key: BufferSource, data: string) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
}

// initData как у Telegram: hash = HMAC(HMAC("WebAppData", токен), строка полей)
async function signedInitData(user: object): Promise<string> {
  const fields: Record<string, string> = {
    query_id: 'dev',
    user: JSON.stringify(user),
    auth_date: String(Math.floor(Date.now() / 1000)),
  }
  const check = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n')
  const secret = await hmac(new TextEncoder().encode('WebAppData'), DEV_BOT_TOKEN)
  return new URLSearchParams({ ...fields, hash: toHex(await hmac(secret, check)) }).toString()
}

const THEMES: Record<string, Record<string, string>> = {
  dark: {
    bg_color: '#17212b', secondary_bg_color: '#0e1621', section_bg_color: '#17212b',
    text_color: '#f5f5f5', hint_color: '#708499', link_color: '#6ab3f3',
    button_color: '#5288c1', button_text_color: '#ffffff', accent_text_color: '#6ab2f2',
    section_header_text_color: '#6ab3f3', section_separator_color: '#111921',
    header_bg_color: '#17212b', subtitle_text_color: '#708499', destructive_text_color: '#ec3942',
  },
  light: {
    bg_color: '#ffffff', secondary_bg_color: '#efeff4', section_bg_color: '#ffffff',
    text_color: '#000000', hint_color: '#999999', link_color: '#2481cc',
    button_color: '#2481cc', button_text_color: '#ffffff', accent_text_color: '#2481cc',
    section_header_text_color: '#6d6d72', section_separator_color: '#c8c7cc',
    header_bg_color: '#f7f7f7', subtitle_text_color: '#999999', destructive_text_color: '#ff3b30',
  },
}

const STORE = 'mock_cloud'

export function installTelegramMock() {
  const search = new URLSearchParams(location.search)
  const theme = search.get('tg')

  // 1. параметры запуска SDK читает из hash при загрузке — подставляем и перезагружаемся
  if (theme !== null && !location.hash.includes('tgWebAppData')) {
    const user = {
      id: Number(search.get('uid') ?? 1),
      first_name: search.get('name') ?? 'Test',
      last_name: 'User',
      username: search.get('username') ?? `test_user_${search.get('uid') ?? 1}`,
    }
    void signedInitData(user).then((initData) => {
      const launch = new URLSearchParams({
        tgWebAppData: initData,
        tgWebAppVersion: '8.0',
        tgWebAppPlatform: 'ios',
        tgWebAppThemeParams: JSON.stringify(THEMES[theme] ?? THEMES.dark),
      })
      location.hash = launch.toString().replace(/\+/g, '%20')
      location.reload()
    })
    return
  }

  // 2. «клиент» отвечает на запросы CloudStorage, как это делает Telegram.
  // SDK запоминает параметры запуска в sessionStorage, так что вкладка остаётся «в Telegram»
  // и после перехода без ?tg — поэтому смотрим на initData, а не на адрес.
  // Настоящий клиент (WebView-прокси или родительское окно Telegram Web) не подменяем.
  const hasRealClient = 'TelegramWebviewProxy' in window || window.parent !== window
  if (!window.Telegram?.WebApp?.initData || hasRealClient) return

  const read = (): Record<string, string> => JSON.parse(localStorage.getItem(STORE) ?? '{}')
  const write = (store: Record<string, string>) => localStorage.setItem(STORE, JSON.stringify(store))
  // Telegram.WebView — внутренний объект SDK, в @types/telegram-web-app его нет
  const webView = (window.Telegram as unknown as { WebView: { receiveEvent: (type: string, data: unknown) => void } })
    .WebView
  const reply = (req_id: string, result: unknown) =>
    setTimeout(() => webView.receiveEvent('custom_method_invoked', { req_id, result }), 50)

  ;(window as unknown as { TelegramWebviewProxy: unknown }).TelegramWebviewProxy = {
    postEvent(type: string, data: string) {
      if (type !== 'web_app_invoke_custom_method') return
      const { req_id, method, params } = JSON.parse(data)
      const store = read()
      switch (method) {
        case 'saveStorageValue':
          store[params.key] = params.value
          write(store)
          return reply(req_id, true)
        case 'getStorageValues':
          return reply(req_id, Object.fromEntries(params.keys.map((k: string) => [k, store[k] ?? ''])))
        case 'deleteStorageValues':
          for (const k of params.keys) delete store[k]
          write(store)
          return reply(req_id, true)
        case 'getStorageKeys':
          return reply(req_id, Object.keys(store))
      }
    },
  }
}
