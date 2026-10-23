// Старосты: «Ещё → Правки группы» — POST /starosta/<действие>, тело — {initData, ...}.
// Только своя группа (users.starosta_of; назначает владелец в админке). Правки — те же, что у владельца
// (отменить, пометка, перенос, добавить пару), с автором; владелец видит их в админке и может откатить.
// Подгруппы: староста создаёт («Англ — Цунаева») и помечает пары из файла ГУУ своей подгруппой.
//
// Ещё здесь: POST /my-subgroups — студент выбирает свои подгруппы (бот, календарь покажут только их),
// POST /extras — правки и подгруппы групп, которые человек смотрит в «Ещё → Расписание группы».
import { cleanEditData, editProblem, type EditKind, type NewEdit } from '../../shared/edits-core'
import { normalizeGroup } from '../../shared/groups'
import { json, readApi } from './api'
import { addEdits, editFromRow, extrasFor, invalidateExtras, loadExtras } from './edits'

const MAX_SUBGROUPS = 20
const MAX_TAGS = 200

type Body = Record<string, unknown>
const fail = (status: number, error: string) => json({ ok: false, error }, status)
const asInt = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null)
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

// Правки группы на сейчас и вперёд (и месяц назад) — с отметкой «моя»; откаченные не показываем
async function groupInfo(env: Env, group: string, me: number) {
  const since = new Date(Date.now() + 3 * 3_600_000 - 30 * 86_400_000).toISOString().slice(0, 10)
  const [edits, extras] = await Promise.all([
    env.DB.prepare(
      `SELECT id, grp, date, start, kind, text, data, created_at, author_id, reverted_at FROM schedule_edits
       WHERE grp = ?1 AND reverted_at IS NULL AND (date >= ?2 OR (kind = 'move' AND json_extract(data, '$.to_date') >= ?2))
       ORDER BY date, start, id`,
    )
      .bind(group, since)
      .all<Parameters<typeof editFromRow>[0]>(),
    loadExtras(env),
  ])
  const own = extrasFor(extras, [group])
  return {
    ok: true,
    group,
    edits: edits.results.map((r) => ({ ...editFromRow(r), mine: r.author_id === me, by_owner: r.author_id === null })),
    subgroups: own.subgroups,
    tags: own.tags,
  }
}

export async function handleStarostaApi(env: Env, request: Request, action: string): Promise<Response> {
  const req = await readApi<Body>(env, request, { write: action !== 'info' })
  if (req instanceof Response) return req
  const group = normalizeGroup(req.user?.starosta_of)
  if (!group) return fail(403, 'not-starosta')
  const me = req.profile.id
  const now = Date.now()

  switch (action) {
    case 'info':
      return json(await groupInfo(env, group, me))

    case 'edit-add': {
      const kind = (typeof req.body.kind === 'string' ? req.body.kind : '') as EditKind
      const edit: Partial<NewEdit> = {
        groups: [group],
        date: str(req.body.date, 10),
        start: typeof req.body.start === 'string' ? req.body.start : null,
        kind,
        text: str(req.body.text, 300),
        data: cleanEditData(kind, req.body.data),
      }
      const problem = editProblem(edit)
      if (problem) return fail(400, problem)
      // подгруппа добавленной пары — только своей группы
      const sub = edit.data && 'subgroup' in edit.data ? edit.data.subgroup : null
      if (sub && !(await loadExtras(env)).subgroups.some((s) => s.id === sub && s.group === group)) return fail(400, 'Нет такой подгруппы')
      await addEdits(env, edit as NewEdit, me)
      return json(await groupInfo(env, group, me))
    }

    // староста убирает правки старост своей группы (правки владельца — только владелец)
    case 'edit-delete': {
      const id = asInt(req.body.id)
      if (id === null) return fail(400, 'bad request')
      const { meta } = await env.DB.prepare(
        'UPDATE schedule_edits SET reverted_at = ? WHERE id = ? AND grp = ? AND author_id IS NOT NULL AND reverted_at IS NULL',
      )
        .bind(now, id, group)
        .run()
      invalidateExtras()
      if (!meta.changes) return fail(404, 'Эту правку убрать нельзя')
      return json(await groupInfo(env, group, me))
    }

    case 'subgroup-add': {
      const name = str(req.body.name, 40)
      if (name.length < 2) return fail(400, 'Напишите название подгруппы')
      const count = (await loadExtras(env)).subgroups.filter((s) => s.group === group).length
      if (count >= MAX_SUBGROUPS) return fail(400, `Не больше ${MAX_SUBGROUPS} подгрупп`)
      await env.DB.prepare('INSERT INTO subgroups (grp, name, created_by, created_at) VALUES (?, ?, ?, ?)').bind(group, name, me, now).run()
      invalidateExtras()
      return json(await groupInfo(env, group, me))
    }

    case 'subgroup-delete': {
      const id = asInt(req.body.id)
      if (id === null) return fail(400, 'bad request')
      await env.DB.batch([
        env.DB.prepare('UPDATE subgroups SET deleted = 1 WHERE id = ? AND grp = ?').bind(id, group),
        env.DB.prepare('DELETE FROM lesson_tags WHERE subgroup_id = ? AND grp = ?').bind(id, group),
      ])
      invalidateExtras()
      return json(await groupInfo(env, group, me))
    }

    // пара из файла ГУУ → подгруппа (день недели, время, предмет, преподаватель)
    case 'tag-add': {
      const weekday = asInt(req.body.weekday)
      const subgroup = asInt(req.body.subgroup)
      const start = str(req.body.start, 5)
      const subject = str(req.body.subject, 200)
      const teacher = str(req.body.teacher, 80) || null
      if (weekday === null || weekday < 0 || weekday > 5 || !/^\d{2}:\d{2}$/.test(start) || !subject || subgroup === null) {
        return fail(400, 'Выберите пару и подгруппу')
      }
      const extras = await loadExtras(env)
      if (!extras.subgroups.some((s) => s.id === subgroup && s.group === group)) return fail(400, 'Нет такой подгруппы')
      if (extras.tags.filter((t) => t.group === group).length >= MAX_TAGS) return fail(400, 'Слишком много пометок')
      await env.DB.batch([
        // одна пара — одна подгруппа
        env.DB.prepare('DELETE FROM lesson_tags WHERE grp = ? AND weekday = ? AND start = ? AND subject = ? AND COALESCE(teacher, \'\') = ?').bind(
          group,
          weekday,
          start,
          subject,
          teacher ?? '',
        ),
        env.DB.prepare(
          'INSERT INTO lesson_tags (grp, weekday, start, subject, teacher, subgroup_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(group, weekday, start, subject, teacher, subgroup, me, now),
      ])
      invalidateExtras()
      return json(await groupInfo(env, group, me))
    }

    case 'tag-delete': {
      const id = asInt(req.body.id)
      if (id === null) return fail(400, 'bad request')
      await env.DB.prepare('DELETE FROM lesson_tags WHERE id = ? AND grp = ?').bind(id, group).run()
      invalidateExtras()
      return json(await groupInfo(env, group, me))
    }
  }
  return fail(404, 'not found')
}

// POST /my-subgroups {group, ids} — свои подгруппы (только существующие подгруппы этой группы)
export async function handleMySubgroups(env: Env, request: Request): Promise<Response> {
  const req = await readApi<{ group?: unknown; ids?: unknown }>(env, request, { write: true })
  if (req instanceof Response) return req
  const group = normalizeGroup(req.body.group)
  if (!group || !Array.isArray(req.body.ids)) return fail(400, 'bad request')
  const valid = new Set((await loadExtras(env)).subgroups.filter((s) => s.group === group).map((s) => s.id))
  const ids = (req.body.ids as unknown[]).filter((x): x is number => typeof x === 'number' && valid.has(x)).slice(0, MAX_SUBGROUPS)
  await env.DB.prepare('UPDATE users SET subgroups = ? WHERE id = ?').bind(ids.length ? JSON.stringify(ids) : null, req.profile.id).run()
  return json({ ok: true, ids })
}

// POST /extras {groups} — правки и подгруппы этих групп (до 8)
export async function handleExtras(env: Env, request: Request): Promise<Response> {
  const req = await readApi<{ groups?: unknown }>(env, request)
  if (req instanceof Response) return req
  const groups = Array.isArray(req.body.groups)
    ? req.body.groups.map(normalizeGroup).filter((g): g is string => Boolean(g)).slice(0, 60) // у преподавателя групп много
    : []
  return json({ ok: true, ...extrasFor(await loadExtras(env), groups) })
}
