import { useEffect, useState } from 'react'
import { Section } from '../components/Section'
import { haptic } from '../telegram'
import { adminApi, adminError, type Settings } from './api'
import { Loading, useFlash } from './common'

// Тексты и режимы без передеплоя: бот читает их из KV (через минуту — у всех)
export function SettingsAdmin() {
  const [form, setForm] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)
  const [flash, notice] = useFlash()

  useEffect(() => {
    adminApi.settings().then(
      (res) => setForm(res.settings),
      (err) => flash(adminError(err)),
    )
  }, [flash])

  if (!form) return <Loading />
  const setGreeting = (i: number, value: string) => setForm({ ...form, greetings: form.greetings.map((g, j) => (j === i ? value : g)) })

  const save = async () => {
    setBusy(true)
    try {
      const res = await adminApi.saveSettings({
        greetings: form.greetings,
        maintenance: form.maintenance,
        notice: { on: form.notice.on, text: form.notice.text, text_en: form.notice.text_en ?? '' },
        channel: form.channel ?? '',
      })
      setForm(res.settings)
      haptic('light')
      flash('Сохранено. У всех — в течение минуты.')
    } catch (err) {
      flash(adminError(err))
    } finally {
      setBusy(false)
    }
  }

  const preview = async (text: string) => {
    try {
      await adminApi.greetingPreview(text)
      flash('Отправил вам в чат с ботом')
    } catch (err) {
      flash(adminError(err))
    }
  }

  return (
    <div className="page-body">
      <Section title="Приветствия на /start" footer="Бот выбирает одно из трёх случайно. {имя} — имя человека. Можно HTML: <b>, <i>, ссылки.">
        <div className="form">
          {form.greetings.map((g, i) => (
            <div key={i} className="form-group">
              <div className="form-label">
                Приветствие {i + 1}
                <button type="button" className="link-btn" onClick={() => preview(g)}>
                  Прислать себе
                </button>
              </div>
              <textarea className="input textarea" rows={5} value={g} onChange={(e) => setGreeting(i, e.target.value)} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Технические работы" footer="Все, кроме вас, увидят вместо приложения этот текст (с английским интерфейсом — английский, если он есть). Бот в чатах работает как обычно.">
        <label className="row row-switch">
          <span className="row-label">Включить</span>
          <input
            type="checkbox"
            className="switch"
            checked={form.maintenance.on}
            onChange={(e) => setForm({ ...form, maintenance: { ...form.maintenance, on: e.target.checked } })}
          />
        </label>
        <div className="row row-form">
          <textarea
            className="input textarea"
            rows={2}
            value={form.maintenance.text}
            onChange={(e) => setForm({ ...form, maintenance: { ...form.maintenance, text: e.target.value } })}
          />
        </div>
        <div className="row row-form">
          <textarea
            className="input textarea"
            rows={2}
            lang="en"
            placeholder="🇬🇧 По-английски (необязательно)"
            value={form.maintenance.text_en ?? ''}
            onChange={(e) => setForm({ ...form, maintenance: { ...form.maintenance, text_en: e.target.value } })}
          />
        </div>
      </Section>

      <Section title="Объявление" footer="Тонкая плашка над расписанием. Закрыл — больше не видит; новый текст покажется всем снова. Английский — для английского интерфейса, пусто — им русский.">
        <label className="row row-switch">
          <span className="row-label">Показывать</span>
          <input
            type="checkbox"
            className="switch"
            checked={form.notice.on}
            onChange={(e) => setForm({ ...form, notice: { ...form.notice, on: e.target.checked } })}
          />
        </label>
        <div className="row row-form">
          <input
            className="input"
            placeholder="Текст объявления"
            maxLength={300}
            value={form.notice.text}
            onChange={(e) => setForm({ ...form, notice: { ...form.notice, text: e.target.value } })}
          />
        </div>
        <div className="row row-form">
          <input
            className="input"
            lang="en"
            placeholder="🇬🇧 По-английски (необязательно)"
            maxLength={300}
            value={form.notice.text_en ?? ''}
            onChange={(e) => setForm({ ...form, notice: { ...form.notice, text_en: e.target.value } })}
          />
        </div>
      </Section>

      <Section title="Канал новостей" footer="Пункт «Другое → Канал новостей». Пусто — пункта нет. Ссылка вида https://t.me/имя_канала или @имя_канала.">
        <div className="row row-form">
          <input
            className="input"
            placeholder="https://t.me/…"
            maxLength={200}
            value={form.channel ?? ''}
            onChange={(e) => setForm({ ...form, channel: e.target.value })}
          />
        </div>
      </Section>

      <button type="button" className="button-primary" disabled={busy} onClick={save}>
        Сохранить
      </button>
      {notice}
    </div>
  )
}
