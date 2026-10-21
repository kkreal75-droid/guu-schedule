import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GroupInfo } from '../../shared/groups'
import { loadGroups } from '../data'
import { GroupSearch } from '../onboarding/GroupSearch'
import { MAX_FAVORITES } from '../prefs'
import { haptic } from '../telegram'
import { useBackButton } from '../useBackButton'
import { t } from '../i18n'

// «+» у чипов над расписанием: найти группу и добавить в избранное (до MAX_FAVORITES)
type Props = {
  exclude: string[] // уже над расписанием
  full: boolean // избранных уже максимум
  onPick: (group: GroupInfo) => void
  onClose: () => void
}

export function AddGroupSheet({ exclude, full, onPick, onClose }: Props) {
  const [groups, setGroups] = useState<GroupInfo[] | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    loadGroups().then((index) => setGroups(index.groups.filter((g) => !exclude.includes(g.id))), () => setError(true))
  }, [exclude])
  useBackButton(onClose)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet sheet-tall" role="dialog" aria-modal="true" aria-label={t('Добавить группу')} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div className="sheet-heading">
            <div className="sheet-title">{t('Добавить группу')}</div>
            <div className="sheet-sub">{t('Появится рядом со своей над расписанием')}</div>
          </div>
          <button type="button" className="sheet-done" onClick={onClose}>
            {t('Закрыть')}
          </button>
        </div>
        {full ? (
          <p className="sheet-text">{t('Избранных групп уже {n} — убери лишнюю в «Профиле».', { n: MAX_FAVORITES })}</p>
        ) : error ? (
          <p className="sheet-text">{t('Не получилось загрузить список групп. Проверь интернет.')}</p>
        ) : !groups ? (
          <p className="sheet-text">{t('Загружаю группы…')}</p>
        ) : (
          <GroupSearch
            groups={groups}
            onPick={(g) => {
              haptic('light')
              onPick(g)
            }}
          />
        )}
      </div>
    </div>,
    document.body,
  )
}
