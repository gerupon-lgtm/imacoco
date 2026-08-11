import { useEffect, useMemo, useState } from 'react'

import { AppIcon } from './components/AppIcon'
import { formatJstDateTime, millisecondsUntilNextMinute } from './domain/time'
import './App.css'

type AppProps = {
  initialNow?: Date
}

type CardProps = {
  id: string
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  className?: string
  headingMeta?: React.ReactNode
}

function useLiveNow(initialNow?: Date) {
  const [now, setNow] = useState(() => initialNow ?? new Date())

  useEffect(() => {
    if (initialNow) return

    let timer = 0

    const schedule = () => {
      window.clearTimeout(timer)
      const current = new Date()
      setNow(current)
      timer = window.setTimeout(schedule, millisecondsUntilNextMinute(current) + 25)
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') schedule()
    }

    timer = window.setTimeout(schedule, millisecondsUntilNextMinute(new Date()) + 25)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [initialNow])

  return now
}

function PinMark() {
  return (
    <svg className="pin-mark" viewBox="0 0 64 80" aria-hidden="true">
      <path d="M32 2C15.4 2 2 15 2 31c0 22 30 47 30 47s30-25 30-47C62 15 48.6 2 32 2Z" />
      <circle cx="32" cy="31" r="12" />
    </svg>
  )
}

function DashboardCard({ id, title, icon, children, className = '', headingMeta }: CardProps) {
  return (
    <section className={`info-card ${className}`} data-card-id={id}>
      <div className="card-heading">
        <span className="card-icon" aria-hidden="true">{icon}</span>
        <h2>{title}</h2>
        {headingMeta}
      </div>
      <div className="card-body">{children}</div>
    </section>
  )
}

export function App({ initialNow }: AppProps) {
  const now = useLiveNow(initialNow)
  const dateTime = useMemo(() => formatJstDateTime(now), [now])

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <PinMark />
          <div>
            <h1>いまここインフォ</h1>
            <p className="copyright">© 2026 SIKUMI LAB</p>
          </div>
        </div>
        <div className="header-actions" aria-label="画面操作">
          <button type="button" className="header-button" aria-label="現在地の情報を更新">
            <AppIcon name="refresh" className="header-action-icon" />
            更新
          </button>
          <button type="button" className="header-button" aria-label="表示内容を共有">
            <AppIcon name="share" className="header-action-icon" />
            共有
          </button>
          <p className="updated-at">更新 {dateTime.timeLabel}</p>
        </div>
      </header>

      <div className="date-rail" aria-label="現在の日本時間">
        <time className="current-date" dateTime={now.toISOString()}>{dateTime.dateLabel}</time>
        <time className="current-clock" dateTime={now.toISOString()}>
          <AppIcon name="clock" /> {dateTime.timeLabel}
        </time>
      </div>

      <main className="dashboard">
        <DashboardCard
          id="location"
          title="いまここ"
          icon={<AppIcon name="pin" />}
          className="location-card"
          headingMeta={<time className="location-acquired" dateTime="2026-08-11T14:31:00+09:00">取得 14:31</time>}
        >
          <div className="location-layout">
            <div className="location-pin"><PinMark /></div>
            <div>
              <p className="location-name">東京都千代田区 丸の内一丁目</p>
              <p className="location-facts">
                <span>精度の目安 ±18m</span>
                <span>標高 約10m（概算）</span>
              </p>
            </div>
          </div>
        </DashboardCard>

        <DashboardCard id="weather" title="天気" icon={<AppIcon name="sun" />}>
          <div className="weather-grid">
            <div className="weather-main"><AppIcon name="partly-cloudy" className="weather-state-icon" /><strong>24.6℃</strong></div>
            <dl className="weather-details">
              <div><dt>体感</dt><dd>25.1℃</dd></div>
              <div><dt>最高</dt><dd className="warm">27℃</dd></div>
              <div><dt>最低</dt><dd className="cool">19℃</dd></div>
              <div><dt>降水</dt><dd>20%</dd></div>
            </dl>
          </div>
          <details className="card-details"><summary>この先6時間</summary></details>
        </DashboardCard>

        <DashboardCard id="solar" title="太陽" icon={<AppIcon name="sun" />} className="compact-card">
          <div className="split-values">
            <div><span className="solar-label"><AppIcon name="sunrise" />日の出</span><strong>5:02</strong></div>
            <div><span className="solar-label"><AppIcon name="sunset" />日の入り</span><strong>18:27</strong></div>
          </div>
        </DashboardCard>

        <DashboardCard id="tide" title="潮の目安" icon={<AppIcon name="waves" />} className="tide-card">
          <span className="badge">概算</span>
          <div className="split-values tide-values">
            <div><span>干潮</span><strong>15:18</strong></div>
            <div><span>満潮</span><strong>21:42</strong></div>
          </div>
          <div className="support-line tide-note">
            <p className="meta-line">約12km先の海洋モデル</p>
            <p className="danger-line">航海・防災には使用不可</p>
          </div>
        </DashboardCard>

        <DashboardCard id="station" title="最寄り駅" icon={<AppIcon name="train" />}>
          <div className="station-row">
            <div>
              <p><strong>東京駅</strong> <span className="meta-inline">約200m 北東</span></p>
              <p className="tags"><span>JR</span><span>東京メトロ</span><span className="plain-tag">複数路線</span></p>
            </div>
            <button type="button" className="primary-button"><AppIcon name="map" />地図で開く</button>
          </div>
          <div className="support-line station-note">
            <details className="inline-details"><summary>ほかの駅を見る</summary></details>
            <p className="meta-line">直線距離・所要時間ではありません</p>
          </div>
        </DashboardCard>

        <DashboardCard id="government" title="役所" icon={<AppIcon name="building" />}>
          <div className="list-row"><span><strong>東京都庁</strong>　約6.7km 西</span><span className="row-actions">公式　地図</span></div>
          <div className="list-row"><span><strong>千代田区役所</strong>　約2.5km 北</span><span className="row-actions">公式　地図</span></div>
        </DashboardCard>

        <DashboardCard id="medical" title="医療機関" icon={<AppIcon name="medical" />}>
          <button type="button" className="list-row full-row"><span>病院　3件</span><AppIcon name="chevron" /></button>
          <button type="button" className="list-row full-row"><span>一般診療所　3件</span><AppIcon name="chevron" /></button>
          <div className="loading-bars" aria-label="その他の医療機関を確認中"><i /><i /><i /><i /></div>
          <div className="support-line medical-note">
            <p className="meta-line">その他の医療機関を確認中…</p>
            <p className="danger-line">緊急時は119</p>
          </div>
        </DashboardCard>
      </main>

      <footer className="app-footer">
        <button type="button"><span className="footer-label"><AppIcon name="shield" />出典・プライバシー</span><AppIcon name="chevron" /></button>
        <button type="button"><span className="footer-label"><AppIcon name="trash" />保存データを消去</span><AppIcon name="chevron" /></button>
        <small>iki-0.1.0</small>
      </footer>
    </div>
  )
}
