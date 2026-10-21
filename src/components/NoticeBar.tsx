import { useEffect, useState } from 'react'
import { CloseIcon } from '../icons'
import { readCloud, readLocal, save } from '../storage'
import { haptic, type Notice } from '../telegram'
import { t, useLang } from '../i18n'

const KEY = 'notice_closed'

// Объявление из админ-панели: тонкая плашка над расписанием. Закрыл — это объявление больше
// не показываем (номер закрытого храним и в CloudStorage — на других устройствах тоже не всплывёт).
export function NoticeBar({ notice }: { notice: Notice }) {
  const lang = useLang()
  const [closed, setClosed] = useState(() => readLocal(KEY))
  useEffect(() => {
    readCloud(KEY).then((value) => value && setClosed(value))
  }, [])
  if (closed === String(notice.id)) return null
  return (
    <div className="notice-bar" role="status">
      {lang === 'en' && notice.text_en ? (
        <span className="notice-text">{notice.text_en}</span>
      ) : (
        <span className="notice-text" lang="ru">
          {notice.text}
        </span>
      )}
      <button
        type="button"
        className="notice-close"
        aria-label={t('Закрыть объявление')}
        onClick={() => {
          haptic()
          save(KEY, String(notice.id))
          setClosed(String(notice.id))
        }}
      >
        <CloseIcon />
      </button>
    </div>
  )
}
