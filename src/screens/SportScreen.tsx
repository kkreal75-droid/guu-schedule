// «Спорт» — физкультура: секции по времени и по секциям (данные — этап 7.4)
export function SportScreen() {
  return (
    <div className="screen">
      <header className="screen-head">
        <h1 className="screen-title">Физкультура</h1>
      </header>
      <div className="page-body">
        <div className="empty">
          <div className="empty-emoji">🏐</div>
          <div className="empty-title">Расписание секций скоро появится</div>
          <div className="empty-text">Как только спортклуб ГУУ опубликует его — секции будут здесь.</div>
        </div>
      </div>
    </div>
  )
}
