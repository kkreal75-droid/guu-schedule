// Данные ГУУ на языке интерфейса (этап 11). Сами данные (группы, предметы, программы) — по-русски, как в файлах
// guu.ru; здесь — подписи к ним. Переводы самих названий — этап 11.2.
import type { GroupInfo } from '../shared/groups'
import { t } from './i18n'

// «Международный бизнес · ИУПСиБК · 1 курс» / «… · Year 1»
export const groupSubtitle = (g: GroupInfo) =>
  [g.program, g.institute, g.level === 'postgrad' ? t('аспирантура, {n} курс', { n: g.course }) : t('{n} курс', { n: g.course })].join(' · ')
