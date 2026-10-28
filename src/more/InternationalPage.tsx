import { useEffect, useState } from 'react'
import { Section } from '../components/Section'
import { weekTitle } from '../format'
import { localPlace, loadPlaces, type Place } from '../places'
import { haptic, openLink } from '../telegram'
import { dayFromIso, moscowNow } from '../../shared/schedule-core'

// «Другое → For international students» (этап 11.4) — только в английском интерфейсе, поэтому тексты сразу
// по-английски (без t()). Коды корпусов и кабинетов — как в файлах ГУУ (lang="ru"). Ссылки — разделы guu.ru
// «Международная деятельность» (визы и миграционный учёт, контакты), общежитие и английская версия сайта.

const SEMESTER_START = '2026-08-31' // понедельник 1-й недели (как semester_start в файлах групп)

// код корпуса в аудитории → id места в «Корпусах ГУУ» (английское название — оттуда же, с правками владельца)
const BUILDINGS: [string, string][] = [['У', 'u'], ['ПА', 'pa'], ['ЛК', 'lk'], ['А', 'a'], ['БЦ', 'bc']] // i18n-ignore
// кабинеты и пример — как в файлах ГУУ
const ROOM_EXAMPLE = 'ЛК-405' // i18n-ignore
const VISA_OFFICE = 'А-111' // i18n-ignore
const INTL_ROOMS = 'А-117, А-121, А-122' // i18n-ignore

const LINKS: { title: string; sub: string; url: string }[] = [
  { title: 'Visas and migration registration', sub: 'guu.ru · in Russian', url: 'https://guu.ru/international-activity/migration-registration/' },
  { title: 'International Office contacts', sub: 'guu.ru · in Russian', url: 'https://guu.ru/international-activity/kontaktnaya-informacziya/' },
  { title: 'International activities', sub: 'guu.ru · in Russian', url: 'https://guu.ru/international-activity/' },
  { title: 'Dormitory', sub: 'guu.ru · in Russian', url: 'https://guu.ru/campus/obshhezhitie/' },
  { title: 'GUU website in English', sub: 'guu.ru/language/en', url: 'https://guu.ru/language/en/' },
]

export function InternationalPage({ onOpen }: { onOpen: (item: 'places' | 'support' | 'faq') => void }) {
  const [places, setPlaces] = useState<Place[] | null>(null)
  useEffect(() => {
    loadPlaces().then(setPlaces, () => setPlaces([]))
  }, [])

  const week = Math.floor((moscowNow().day - dayFromIso(SEMESTER_START)) / 7) + 1
  const buildings = BUILDINGS.map(([code, id]) => ({ code, place: places?.find((p) => p.id === id) })).filter(
    (b): b is { code: string; place: Place } => Boolean(b.place),
  )
  const go = (item: 'places' | 'support' | 'faq') => {
    haptic()
    onOpen(item)
  }

  return (
    <div className="page-body intl">
      <p className="lead">
        Welcome to GUU! The official schedule is published in Russian — this app translates it for you. Here’s how to read
        it.
      </p>

      <Section title="Even and odd weeks">
        <div className="row row-text">
          Some classes take place every week, others only on even or only on odd weeks. Weeks are counted from the start of
          the semester (31 August is week 1).
        </div>
        <div className="row row-text">
          The week card above the days shows which week it is — and the app already shows only this week’s classes.
          {week >= 1 && week <= 26 && (
            <>
              {' '}
              Now: <b>{weekTitle(week)}</b>.
            </>
          )}
        </div>
      </Section>

      <Section title="Building codes" footer="The first digit of the room number is usually the floor.">
        <div className="row row-text">
          A room code is the building plus the room number: <b lang="ru">{ROOM_EXAMPLE}</b> — Laboratory building, room 405.
        </div>
        {buildings.map(({ code, place }) => (
          <div key={code} className="row intl-code">
            <b lang="ru" className="intl-code-key">
              {code}
            </b>
            <span className="intl-code-name">{localPlace(place).name}</span>
          </div>
        ))}
        <button type="button" className="row row-btn row-link" onClick={() => go('places')}>
          Campus map and how to get there
        </button>
      </Section>

      <Section title="Types of classes">
        <div className="row row-text">
          <b>Lecture</b> — for the whole stream (several groups), usually in a big hall.
        </div>
        <div className="row row-text">
          <b>Seminar</b> — practical class for your group.
        </div>
        <div className="row row-text">
          <b>Lab</b> — practical work in a computer or other lab, often in subgroups.
        </div>
        <div className="row row-text">
          <b>Foreign language</b> is listed for the whole stream in several slots at once, but you attend only your own.
          Hide the others: tap <b>⋯</b> on the class → <b>Not my class</b>.
        </div>
      </Section>

      <Section title="Visas and migration registration" footer="A short summary of the GUU page — always check the official rules.">
        <div className="row row-text">
          Arriving for the first time: within <b>2 days</b>, go to the Passport and Visa Office, room{' '}
          <b lang="ru">{VISA_OFFICE}</b> (Administration building), with your passport, migration card and visa.
        </div>
        <div className="row row-text">
          Extend your registration <b>20 days</b> before it ends. A multiple-entry study visa — apply at least <b>21 days</b>{' '}
          before your visa expires.
        </div>
        <div className="row row-text">Leaving Russia? Tell the office, and come back to re-register as soon as you return.</div>
      </Section>

      <Section title="International Office">
        <div className="row row-text">
          Administration building, rooms <span lang="ru">{INTL_ROOMS}</span>
          <br />
          Phone: +7 (495) 377-77-88, ext. 12-76, 13-81, 24-14
          <br />
          Email: inf@guu.ru
        </div>
      </Section>

      <Section title="Useful links">
        {LINKS.map((link) => (
          <button
            key={link.url}
            type="button"
            className="row row-btn intl-link"
            onClick={() => {
              haptic()
              openLink(link.url)
            }}
          >
            <span className="intl-link-title">{link.title}</span>
            <span className="intl-link-sub">{link.sub}</span>
          </button>
        ))}
      </Section>

      <Section title="Need help?" footer="This is a student project, not an official GUU service.">
        <div className="row row-text">Something wrong in the schedule or the app? Write to us — in English is fine.</div>
        <button type="button" className="row row-btn row-link" onClick={() => go('support')}>
          Contact support
        </button>
        <button type="button" className="row row-btn row-link" onClick={() => go('faq')}>
          FAQ
        </button>
      </Section>
    </div>
  )
}
