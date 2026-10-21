// Проверка перевода интерфейса (этап 11), npm run i18n; в CI — .github/workflows/tests.yml.
// 1) В коде приложения нет русского текста мимо t('…') / tn('…') (строки, шаблоны, текст в JSX).
//    Исключения: админ-панель (только владелец, по-русски), src/dev, словари; данные ГУУ и прочее нарочно
//    русское — комментарий «i18n-ignore» на той же или предыдущей строке.
// 2) У каждой строки из t('…') / tn('…') есть английский перевод в src/i18n/en.ts (у tn — две формы).
// Разбор — парсер rolldown (идёт с Vite): у TypeScript 7 нет JS-API компилятора.
import fs from 'node:fs'
import path from 'node:path'
import { parseAst } from 'rolldown/parseAst'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const SKIP = [/^src\/admin\//, /^src\/dev\//, /^src\/i18n\//, /\.d\.ts$/]
const CYRILLIC = /[А-Яа-яЁё]/

function files(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) return files(rel)
    return /\.(ts|tsx)$/.test(e.name) && !SKIP.some((re) => re.test(rel)) ? [rel] : []
  })
}

// обход ESTree с родителем (родители запоминаем — для t(`…`) нужен дед шаблонной строки)
const parentOf = new Map()
function walk(node, parent, visit) {
  if (!node || typeof node.type !== 'string') return
  parentOf.set(node, parent)
  visit(node, parent)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue
    if (Array.isArray(value)) value.forEach((child) => walk(child, node, visit))
    else if (value && typeof value === 'object' && typeof value.type === 'string') walk(value, node, visit)
  }
}

const parse = (rel) => {
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  return { text, ast: parseAst(text, { lang: rel.endsWith('.tsx') ? 'tsx' : 'ts' }, rel) }
}

// словарь: русская строка → английская (src/i18n/en.ts)
function loadEn() {
  const { ast } = parse('src/i18n/en.ts')
  const en = new Map()
  walk(ast, null, (node) => {
    if (node.type !== 'Property') return
    const key = node.key.type === 'Literal' ? node.key.value : node.key.type === 'Identifier' ? node.key.name : null
    const v = node.value
    const value = v.type === 'Literal' ? v.value : v.type === 'TemplateLiteral' && !v.expressions.length ? v.quasis[0].value.cooked : null
    if (typeof key === 'string' && typeof value === 'string') en.set(key, value)
  })
  return en
}

const en = loadEn()
const problems = []
const keys = new Set()
const isTCall = (node) => node?.type === 'CallExpression' && node.callee.type === 'Identifier' && (node.callee.name === 't' || node.callee.name === 'tn')

for (const rel of files('src')) {
  const { text, ast } = parse(rel)
  const lineStarts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1)
  const lineOf = (pos) => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= pos) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  const lines = text.split('\n')
  const ignored = (node) => {
    const line = lineOf(node.start)
    return /i18n-ignore/.test(lines[line] ?? '') || /i18n-ignore/.test(lines[line - 1] ?? '')
  }
  const where = (node) => `${rel}:${lineOf(node.start) + 1}`

  walk(ast, null, (node, parent) => {
    if (isTCall(node)) {
      const arg = node.arguments[node.callee.name === 'tn' ? 1 : 0] // tn(n, 'пара|пары|пар')
      const key = arg?.type === 'Literal' ? arg.value : arg?.type === 'TemplateLiteral' && !arg.expressions.length ? arg.quasis[0].value.cooked : null
      if (typeof key !== 'string') return void problems.push(`${where(node)}  t() не со строкой — перевод не проверить`)
      keys.add(key)
      const value = en.get(key)
      if (value === undefined) problems.push(`${where(arg)}  нет перевода: ${JSON.stringify(key)}`)
      else if (node.callee.name === 'tn' && !value.includes('|')) problems.push(`${where(arg)}  у множественного числа одна форма: ${JSON.stringify(key)}`)
      else if (CYRILLIC.test(value)) problems.push(`${where(arg)}  в переводе кириллица: ${JSON.stringify(value)}`)
      return
    }
    let value = null
    if (node.type === 'Literal' && typeof node.value === 'string') value = node.value
    else if (node.type === 'TemplateElement') value = node.value.cooked ?? node.value.raw
    else if (node.type === 'JSXText') value = node.value
    if (value === null || !CYRILLIC.test(value) || ignored(node)) return
    // console.* — для разработчика, не интерфейс
    for (let up = parent; up; up = parentOf.get(up)) {
      if (up.type === 'CallExpression' && up.callee.type === 'MemberExpression' && up.callee.object.type === 'Identifier' && up.callee.object.name === 'console') return
    }
    const keyArg = (call) => call.arguments[call.callee.name === 'tn' ? 1 : 0]
    if (isTCall(parent) && keyArg(parent) === node) return
    if (parent?.type === 'TemplateLiteral' && isTCall(parentOf.get(parent)) && keyArg(parentOf.get(parent)) === parent) return
    if (parent && (parent.type === 'ImportDeclaration' || parent.type === 'ExportNamedDeclaration' || parent.type === 'ExportAllDeclaration')) return
    problems.push(`${where(node)}  русский текст мимо t(): ${JSON.stringify(value.trim().slice(0, 70))}`)
  })
}

const unused = [...en.keys()].filter((k) => !keys.has(k))
if (problems.length) {
  console.error(problems.join('\n'))
  console.error(`\n✖ Проблем: ${problems.length}`)
  process.exit(1)
}
console.log(`✓ Перевод: строк ${keys.size}, русского текста мимо t() нет${unused.length ? `; лишних в словаре: ${unused.length}` : ''}`)
