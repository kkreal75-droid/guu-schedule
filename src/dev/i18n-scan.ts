// Проверка английской версии на отрисованных экранах (этап 11), только в разработке:
//   http://localhost:5173/?tg&uid=…&lang=en&scan — после запуска обходит «Расписание», «Профиль», «Другое» и все его
//   пункты (кроме админки) и ищет видимый русский текст (и в aria-label / placeholder / title) вне данных ГУУ
//   (они помечены lang="ru"). Итог — в консоли и плашкой внизу экрана: «i18n-scan: OK» или список находок.
// Статическая проверка того же в CI — scripts/i18n_check.mjs.
const CYRILLIC = /[А-Яа-яЁё]/
const ALLOWED = new Set(['Язык · Language', 'Русский']) // i18n-ignore — названия языка на нём самом

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function scan(screen: string): string[] {
  const found = new Set<string>()
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim() ?? ''
    const el = node.parentElement
    if (!text || !CYRILLIC.test(text) || ALLOWED.has(text) || !el || el.closest('[lang="ru"], script, style, #i18n-scan')) continue
    found.add(`${screen}: ${text.slice(0, 80)}`)
  }
  for (const el of document.querySelectorAll('[aria-label], [placeholder], [title]')) {
    if (el.closest('[lang="ru"]')) continue
    for (const attr of ['aria-label', 'placeholder', 'title']) {
      const value = el.getAttribute(attr)
      if (value && CYRILLIC.test(value) && !ALLOWED.has(value)) found.add(`${screen}: @${attr} ${value.slice(0, 60)}`)
    }
  }
  return [...found]
}

export async function runI18nScan(): Promise<string[]> {
  await wait(2500)
  const tabs = () => [...document.querySelectorAll<HTMLButtonElement>('nav.tabbar button')]
  const problems: string[] = []
  for (const [i, name] of [[0, 'schedule'], [2, 'profile'], [1, 'more']] as const) {
    tabs()[i]?.click()
    await wait(600)
    problems.push(...scan(name))
  }
  const titles = [...document.querySelectorAll('.other-row .other-title')].map((el) => el.textContent ?? '')
  for (const title of titles) {
    const row = [...document.querySelectorAll<HTMLButtonElement>('.other-row')].find((b) => b.querySelector('.other-title')?.textContent === title)
    if (!row || row.querySelector('.ic-gray')) continue // админ-панель — только по-русски
    row.click()
    await wait(1800)
    problems.push(...scan(title))
    document.querySelector<HTMLButtonElement>('.page-back')?.click()
    await wait(400)
  }
  const report = problems.length ? `i18n-scan: ${problems.length}\n${problems.join('\n')}` : 'i18n-scan: OK'
  console.log(report)
  const box = document.createElement('pre')
  box.id = 'i18n-scan'
  box.textContent = report
  box.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:99;max-height:40vh;overflow:auto;padding:8px;border-radius:8px;background:#111;color:#0f0;font-size:11px;white-space:pre-wrap'
  document.body.append(box)
  return problems
}
