// Фильтр мата для доски. Списки — в board-config.ts.
import { BAD_EXACT, BAD_LATIN, BAD_WORDS } from './board-config'

// латинские буквы и цифры, похожие на русские: «xyй», «6лять», «пи3да»
const LOOKALIKE: Record<string, string> = {
  a: 'а', b: 'б', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', n: 'п', o: 'о', p: 'р', r: 'г', t: 'т',
  u: 'у', x: 'х', y: 'у', '0': 'о', '3': 'з', '4': 'ч', '6': 'б', '@': 'а',
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const anyOf = (items: string[]) => items.map(escapeRe).join('|')

const CYRILLIC = BAD_WORDS.map(({ prefixes, roots }) => new RegExp(`^(?:${anyOf(prefixes)})(?:${anyOf(roots)})`))
const EXACT = new Set(BAD_EXACT)
const LATIN = new RegExp(`^(?:${anyOf(BAD_LATIN)})`)

// «хууууй» → «хуй»
const collapse = (word: string) => word.replace(/(.)\1+/gu, '$1')

function words(text: string): string[] {
  const parts = text.toLowerCase().replace(/ё/g, 'е').split(/[^\p{L}\d@]+/u).filter(Boolean)
  // «х у й», «х.у.й» — одиночные буквы подряд склеиваем в одно слово
  const out: string[] = []
  let run = ''
  for (const part of parts) {
    if ([...part].length === 1) {
      run += part
      continue
    }
    if (run) out.push(run)
    run = ''
    out.push(part)
  }
  if (run) out.push(run)
  return out
}

export function passesFilter(text: string): boolean {
  for (const word of words(text)) {
    if (/[а-я]/.test(word)) {
      const normal = collapse([...word].map((ch) => LOOKALIKE[ch] ?? ch).join(''))
      if (EXACT.has(normal) || CYRILLIC.some((re) => re.test(normal))) return false
    } else if (/^[a-z]+$/.test(word) && LATIN.test(collapse(word))) {
      return false
    }
  }
  return true
}
