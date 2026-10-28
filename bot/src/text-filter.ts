// Фильтр мата для текстов пользователей (отзывы о преподавателях, обращения в поддержку).
// Слово (после нормализации: регистр, ё→е, латинские двойники букв, повторы) ловится, если
// начинается с одной из приставок и дальше идёт корень. Приставки у групп разные, чтобы не
// ловить обычные слова: «себе» не «с+ебе», «бляха» не «бля», «сукно» не «сука».

const BAD_WORDS: { prefixes: string[]; roots: string[] }[] = [
  {
    prefixes: ['', 'на', 'по', 'о', 'ни', 'за', 'от', 'вы', 'до', 'рас', 'раз', 'с', 'у', 'при', 'пере', 'недо', 'об'],
    roots: ['хуй', 'хуе', 'хуя', 'хую', 'хуи', 'пизд', 'пезд'],
  },
  {
    prefixes: [
      '', 'за', 'на', 'по', 'от', 'вы', 'у', 'при', 'до', 'пере', 'недо', 'долбо', 'долба',
      'подъ', 'подь', 'съ', 'сь', 'въ', 'вь', 'разъ', 'разь', 'изъ', 'изь', 'объ', 'обь', 'взъ', 'взь', 'отъ', 'оть',
    ],
    roots: ['еба', 'ебу', 'ебл', 'ебн', 'ебе', 'еби', 'ебо', 'ебы', 'ебк', 'ебш'],
  },
  {
    prefixes: [''],
    roots: [
      'блят', 'бляд', 'мудак', 'мудач', 'мудил', 'мудозвон', 'залуп', 'гандон', 'гондон', 'шлюх',
      'пидор', 'пидар', 'пидр', 'сука', 'суки', 'суку', 'сукой', 'сукам', 'сукин', 'сучк', 'сучар', 'сучь',
    ],
  },
]
// целые слова
const BAD_EXACT = ['бля', 'сук', 'ебать']
// то же латиницей (translit)
const BAD_LATIN = [
  'huy', 'hui', 'huj', 'hue', 'pizd', 'pezd', 'blyat', 'blyad', 'blya', 'ebat', 'ebal', 'eban', 'ebash',
  'zaeb', 'naeb', 'uebo', 'uebi', 'pidor', 'pidar', 'mudak', 'zalup', 'gandon', 'suka', 'suki', 'shluh',
]

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

// убираем невидимые и управляющие символы, лишние пустые строки (эмодзи с ZWJ не трогаем)
export const cleanText = (text: unknown) =>
  typeof text === 'string'
    ? text
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f​‎‏‪-‮⁦-⁩﻿]/g, '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : ''
