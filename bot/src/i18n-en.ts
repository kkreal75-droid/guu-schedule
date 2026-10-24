// Английский словарь бота (этап 11): русская строка из кода → перевод. {имя} в фигурных скобках — подстановка,
// её не переводить. Проверка, что у каждой строки tr() есть перевод, — npm run i18n.
export const EN: Record<string, string> = {
  // ---------- общее ----------
  'Что-то сломалось 🛠': 'Something broke 🛠',
  'Доступ к боту ограничен.': 'Access to the bot is restricted.',
  '📅 Открыть расписание': '📅 Open schedule',
  брат: 'bro',

  // ---------- расписание (/today, inline, беседы) ----------
  'Не нашёл расписание вашей группы — откройте приложение и выберите группу заново.':
    "Couldn't find your group's schedule — open the app and pick your group again.",
  'Вне учебного семестра.': 'Outside the semester.',
  'Воскресенье — выходной 🌿': 'Sunday — day off 🌿',
  'Пар нет 🎉': 'No classes 🎉',
  'Сегодня пар нет 🎉': 'No classes today 🎉',
  'Неделя {range}': 'Week {range}',
  Отменена: 'Cancelled',
  'Перенесена на {when}': 'Moved to {when}',
  'Перенос с {when}': 'Moved from {when}',
  Добавлена: 'Added',
  '{n} пара': 'Class {n}',
  '🎉 Каникулы! Пар нет до {date}': '🎉 Holidays! No classes until {date}',
  'Сегодня проектное обучение — {n} {events}': 'Project learning today — {n} {events}',
  'мероприятие|мероприятия|мероприятий': 'event|events',
  'Сегодня проектное обучение — мероприятий пока нет': 'Project learning today — no events yet',
  '🔄 <b>Расписание обновилось</b>\nВ файле ГУУ поменялись пары твоей группы — загляни в расписание.':
    "🔄 <b>Schedule updated</b>\nGUU changed your group's classes — check your schedule.",
  // виды пар и места без номера аудитории (как в файлах ГУУ)
  Лекция: 'Lecture',
  Практика: 'Seminar',
  Лабораторная: 'Lab',
  'Спортивный комплекс': 'Sports complex',
  'Актовый зал': 'Assembly hall',

  // ---------- inline ----------
  Сегодня: 'Today',
  Завтра: 'Tomorrow',
  Послезавтра: 'Day after tomorrow',
  Неделя: 'Week',
  'вне семестра': 'outside the semester',
  'пар нет': 'no classes',

  // ---------- «Изменение в расписании» ----------
  'Изменение в расписании': 'Schedule change',
  'было:': 'was:',
  'стало:': 'now:',
  'Теперь в этот день пар нет 🎉': 'No classes on this day now 🎉',

  // ---------- бот в беседе ----------
  '👋 Привет! Я присылаю расписание группы ГУУ в беседу:\n• каждый учебный день утром — пары на сегодня;\n• в субботу вечером — неделю вперёд;\n• если пары поменяются — сразу напишу, что изменилось.\n\nАдмин беседы, настройте меня: /setup':
    "👋 Hi! I send a GUU group's schedule to the chat:\n• every school day in the morning — today's classes;\n• on Saturday evening — the week ahead;\n• if classes change — I'll write right away what changed.\n\nChat admin, set me up: /setup",
  Настройка: 'Setup',
  'Какая группа в этой беседе?': 'Which group is this chat for?',
  'Другая группа? Напишите /setup и её название — например, <code>/setup ГМУ 2-3</code>.':
    'Another group? Write /setup and its name — for example, <code>/setup ГМУ 2-3</code>.',
  'Не нашёл группу «{query}». Попробуйте иначе: <code>/setup МБ(МП) 1-1</code>, <code>/setup маркетинг 2</code>.':
    'Couldn\'t find the group "{query}". Try another way: <code>/setup МБ(МП) 1-1</code>, <code>/setup маркетинг 2</code>.',
  'Если вашей нет в списке — уточните название.': "If yours isn't on the list, make the name more specific.",
  'Выберите группу:': 'Pick the group:',
  '{name} · {institute}, {course} к.': '{name} · {institute}, year {course}',
  'Группа: <b>{group}</b>.': 'Group: <b>{group}</b>.',
  'Во сколько присылать пары на день (по Москве)?': 'When should I send the day’s classes (Moscow time)?',
  'Не присылать по утрам': "Don't send in the morning",
  'Каждый учебный день в {time} пришлю пары{group}, по субботам вечером — неделю вперёд, а если расписание поменяется — сразу напишу.':
    "Every school day at {time} I'll send the classes{group}, on Saturday evenings — the week ahead, and if the schedule changes — I'll write right away.",
  'По утрам присылать не буду. Пары можно посмотреть командами ниже.': "I won't send anything in the morning. You can check classes with the commands below.",
  Готово: 'Done',
  'Готово! Буду присылать расписание в эту тему 👍': "Done! I'll send the schedule to this topic 👍",
  'Готово! Буду присылать расписание сюда 👍': "Done! I'll send the schedule here 👍",
  '/today — пары на сегодня\n/tomorrow — на завтра': "/today — today's classes\n/tomorrow — tomorrow's",
  '/here — присылать в другую тему (написать в ней)': '/here — send to another topic (write it there)',
  '/off — выключить автосообщения\n/setup — настроить заново': '/off — turn off automatic messages\n/setup — set up again',
  'Язык сообщений:': 'Message language:',
  Сохранено: 'Saved',
  'Настроить бота могут только админы беседы.': 'Only chat admins can set up the bot.',
  'Настроить бота могут только админы беседы': 'Only chat admins can set up the bot',
  'Перепривязать рассылку могут только админы беседы.': 'Only chat admins can move the messages to another topic.',
  'Выключить бота могут только админы беседы.': 'Only chat admins can turn the bot off.',
  'Сначала настройте бота: /setup': 'Set up the bot first: /setup',
  'Такой группы больше нет — повторите /setup': "This group doesn't exist anymore — run /setup again",
  '🔕 Автосообщения выключены. /today и /tomorrow работают как раньше, включить снова — /setup.':
    '🔕 Automatic messages are off. /today and /tomorrow still work; to turn them back on — /setup.',

  // ---------- /deleteme ----------
  '🗑 <b>Удалить твои данные?</b>\n\nУдалятся: профиль (группа, роль, имя и ник), подписка на календарь, подгруппы, скрытые пары, история визитов, обращения в поддержку.\nОтзывы о преподавателях останутся, но без связи с тобой — даже для администратора.\n\nЗаметки к парам хранятся в облаке Telegram в твоём аккаунте — бот их не видит; удалить их можно в приложении.':
    "🗑 <b>Delete your data?</b>\n\nThis deletes: your profile (group, role, name and username), calendar subscription, subgroups, hidden classes, visit history and support requests.\nYour teacher reviews stay, but without any link to you — even for the administrator.\n\nNotes on classes are stored in Telegram's cloud in your account — the bot can't see them; you can delete them in the app.",
  'Да, удалить': 'Yes, delete',
  Отмена: 'Cancel',
  'Хорошо, ничего не удаляю.': "OK, I won't delete anything.",
  '✅ Готово: твои данные удалены. Отзывы остались без связи с тобой.': '✅ Done: your data has been deleted. Your reviews stay, without any link to you.',

  // ---------- поддержка, сессия ----------
  'Ответ на твоё обращение': 'Reply to your support request',
  '📚 Опубликовано расписание сессии — смотри в приложении': '📚 The exam session schedule is out — check it in the app',
  'Открыть расписание сессии': 'Open exam schedule',

  // ---------- календарь на телефоне ----------
  'Расписание {group}': 'Schedule {group}',
  'Подписка на расписание': 'Schedule subscription',
  'Календарь отключён': 'Calendar disconnected',
  'Подключите его заново в приложении: Ещё → Календарь на телефоне.': 'Connect it again in the app: More → Phone calendar.',
  'Сейчас откроется Календарь — нажмите «Подписаться».': 'The Calendar app will open now — tap "Subscribe".',
  'Подписаться в Календаре': 'Subscribe in Calendar',
  'Если ничего не открылось — нажмите кнопку.': "If nothing opened, tap the button.",
}
