import './style.css'
import { ensureBillingReady, purchaseProduct } from './billing'
import type { BillingProductId } from './billing'
import { getSupabase } from './supabaseClient'

type Grid = (string | 0)[][]
type Vec2 = { x: number; y: number }

type PieceKey = 'I' | 'J' | 'L' | 'O' | 'S' | 'T' | 'Z'

type ModeKey = 'classic' | 'hard' | 'online' | 'gravity'

type ThemeKey = 'neon' | 'midnight' | 'sand' | 'mint'

type RunningState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'gameover'

type ScreenMode = 'menu' | 'game'

interface RankingEntry {
  name: string
  score: number
  mode: ModeKey
  date: number
}

interface PieceShape {
  key: PieceKey
  rotations: number[][][]
  color: string
}

interface FallingPiece {
  key: PieceKey
  rotation: number
  position: Vec2
}

interface HeartState {
  hearts: number
  rechargeQueue: number[] // epoch ms per empty slot
  unlimitedUntil?: number
}

interface GameState {
  grid: Grid
  active?: FallingPiece
  nextQueue: PieceKey[]
  hold?: PieceKey
  holdLocked: boolean
  score: number
  combo: number
  lines: number
  level: number
  dropInterval: number
  dropTimer: number
  mode: ModeKey
  running: RunningState
  effects: Effect[]
  garbageTimer: number
  gravityTimer: number
  speedTimer: number
  multiplier: number
  screen: ScreenMode
  reviveUsed: boolean
  clearingLines: number[] // for animation
  gravityDropping: boolean // for animation
}

interface Effect {
  id: string
  label: string
  x: number
  y: number
  life: number
}

interface Theme {
  name: string
  vars: Record<string, string>
}

const BOARD_COLS = 10
const BOARD_ROWS = 20
const HIDDEN_ROWS = 2
const TILE = 28
const NEXT_CANVAS_WIDTH = TILE * 5
const NEXT_CANVAS_HEIGHT = TILE * 6.5
const SOFT_DROP_MULTIPLIER = 18
const HARD_DROP_BONUS = 6
const HEART_MAX = 3
const HEART_RECHARGE_MS = 30 * 60 * 1000
const PRODUCT_MAP: Record<string, BillingProductId> = {
  '1': 'heart_1',
  '3': 'heart_3',
  unli: 'heart_1h',
  '24h': 'heart_24h',
  '30d': 'heart_30d'
}

const themes: Record<ThemeKey, Theme> = {
  neon: {
    name: '네온 팝',
    vars: {
      '--bg': '#05060d',
      '--panel': '#0f1628',
      '--panel-2': '#0c1020',
      '--border': '#24304d',
      '--accent': '#ff6bcb',
      '--accent-2': '#4de1ff',
      '--text': '#e8f1ff',
      '--muted': '#9fb3d7',
      '--grid': '#11182d'
    }
  },
  midnight: {
    name: '미드나이트',
    vars: {
      '--bg': '#0b0c13',
      '--panel': '#151827',
      '--panel-2': '#10121d',
      '--border': '#242a3f',
      '--accent': '#6fd1ff',
      '--accent-2': '#ffb86c',
      '--text': '#e5e9f0',
      '--muted': '#97a1b7',
      '--grid': '#111423'
    }
  },
  sand: {
    name: '샌드',
    vars: {
      '--bg': '#f4ede1',
      '--panel': '#fff8ed',
      '--panel-2': '#f0e5d6',
      '--border': '#d3c2a5',
      '--accent': '#e76f51',
      '--accent-2': '#2a9d8f',
      '--text': '#2b2721',
      '--muted': '#6d5c4f',
      '--grid': '#e1d4c1'
    }
  },
  mint: {
    name: '민트',
    vars: {
      '--bg': '#0f1d1a',
      '--panel': '#142723',
      '--panel-2': '#0f1f1c',
      '--border': '#24433b',
      '--accent': '#5cf0c2',
      '--accent-2': '#7fb7ff',
      '--text': '#e9fff8',
      '--muted': '#9cc8b8',
      '--grid': '#0f251f'
    }
  }
}

const tetrominoes: Record<PieceKey, PieceShape> = {
  I: {
    key: 'I',
    color: '#4de1ff',
    rotations: [
      [
        [0, 0, 0, 0],
        [1, 1, 1, 1],
        [0, 0, 0, 0],
        [0, 0, 0, 0]
      ],
      [
        [0, 1, 0, 0],
        [0, 1, 0, 0],
        [0, 1, 0, 0],
        [0, 1, 0, 0]
      ]
    ]
  },
  J: {
    key: 'J',
    color: '#4f6bff',
    rotations: [
      [
        [1, 0, 0],
        [1, 1, 1],
        [0, 0, 0]
      ],
      [
        [0, 1, 1],
        [0, 1, 0],
        [0, 1, 0]
      ],
      [
        [0, 0, 0],
        [1, 1, 1],
        [0, 0, 1]
      ],
      [
        [0, 1, 0],
        [0, 1, 0],
        [1, 1, 0]
      ]
    ]
  },
  L: {
    key: 'L',
    color: '#ffb347',
    rotations: [
      [
        [0, 0, 1],
        [1, 1, 1],
        [0, 0, 0]
      ],
      [
        [0, 1, 0],
        [0, 1, 0],
        [0, 1, 1]
      ],
      [
        [0, 0, 0],
        [1, 1, 1],
        [1, 0, 0]
      ],
      [
        [1, 1, 0],
        [0, 1, 0],
        [0, 1, 0]
      ]
    ]
  },
  O: {
    key: 'O',
    color: '#ffe267',
    rotations: [
      [
        [1, 1],
        [1, 1]
      ]
    ]
  },
  S: {
    key: 'S',
    color: '#63e28c',
    rotations: [
      [
        [0, 1, 1],
        [1, 1, 0],
        [0, 0, 0]
      ],
      [
        [0, 1, 0],
        [0, 1, 1],
        [0, 0, 1]
      ]
    ]
  },
  T: {
    key: 'T',
    color: '#c37bff',
    rotations: [
      [
        [0, 1, 0],
        [1, 1, 1],
        [0, 0, 0]
      ],
      [
        [0, 1, 0],
        [0, 1, 1],
        [0, 1, 0]
      ],
      [
        [0, 0, 0],
        [1, 1, 1],
        [0, 1, 0]
      ],
      [
        [0, 1, 0],
        [1, 1, 0],
        [0, 1, 0]
      ]
    ]
  },
  Z: {
    key: 'Z',
    color: '#ff6b6b',
    rotations: [
      [
        [1, 1, 0],
        [0, 1, 1],
        [0, 0, 0]
      ],
      [
        [0, 0, 1],
        [0, 1, 1],
        [0, 1, 0]
      ]
    ]
  }
}

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('앱 루트를 찾지 못했습니다.')

app.innerHTML = `
  <div class="shell">
    <div class="loading" id="loading">
      <div class="loading-logo">테토리스</div>
      <p>테스토스테론이 넘치는 시원한 테트리스</p>
      <div class="loading-bar"><span id="loading-bar"></span></div>
      <div class="loading-text" id="loading-text">로딩 준비 중...</div>
    </div>

    <div class="menu-screen" id="menu-screen">
      <div class="menu-header">
        <div class="menu-logo">테토리스</div>
        <p class="menu-tagline">테스토스테론이 넘치는 시원한 테트리스</p>
      </div>
      <div class="mode-grid">
        <div class="mode-card" data-mode="classic">
          <div class="mode-icon">📦</div>
          <div class="mode-title">클래식</div>
          <div class="mode-description">안정된 속도로 즐기는 정통 테트리스</div>
        </div>
        <div class="mode-card" data-mode="hard">
          <div class="mode-icon">🔥</div>
          <div class="mode-title">하드</div>
          <div class="mode-description">점점 빨라지고 가비지가 올라오는 극한 도전</div>
        </div>
        <div class="mode-card" data-mode="gravity">
          <div class="mode-icon">🌊</div>
          <div class="mode-title">그래비티</div>
          <div class="mode-description">라인 제거 시 위 3줄이 중력으로 낙하</div>
        </div>
        <div class="mode-card" data-mode="online">
          <div class="mode-icon">⚡</div>
          <div class="mode-title">온라인</div>
          <div class="mode-description">랭크 매치 느낌의 긴장감 넘치는 대결</div>
        </div>
      </div>
      <div class="menu-bottom">
        <div class="menu-hearts">
          <div class="hearts" id="menu-hearts"></div>
          <div class="recharge" id="menu-recharge"></div>
        </div>
        <div class="menu-buttons">
          <button class="ghost" id="menu-store-btn">하트 상점</button>
          <button class="ghost" id="menu-theme-btn">테마 변경</button>
        </div>
      </div>
      <div class="menu-ranking">
        <h3>🏆 명예의 전당</h3>
        <div class="ranking-tabs" id="ranking-tabs">
          <button data-mode="all" class="active">전체</button>
          <button data-mode="classic">클래식</button>
          <button data-mode="hard">하드</button>
          <button data-mode="gravity">그래비티</button>
          <button data-mode="online">온라인</button>
        </div>
        <ul id="menu-ranking" class="ranking"></ul>
      </div>
    </div>

    <div class="game-screen" id="game-screen">
      <header class="topbar">
        <div class="brand">
          <div class="wordmark">테토리스</div>
          <div class="tagline">시원하게 쌓고, 터뜨리고, 랭크를 올리자</div>
        </div>
        <div class="top-actions">
          <div class="hearts" id="hearts"></div>
          <div class="recharge" id="recharge"></div>
          <button class="ghost" id="menu-btn">일시정지</button>
          <button class="ghost" id="store-btn">하트 상점</button>
          <button class="ghost" id="theme-btn">테마</button>
        </div>
      </header>

      <div class="layout">
        <section class="board-panel">
          <div class="hud">
            <div class="hud-block">
              <div class="label">모드</div>
              <div class="value" id="mode-display">-</div>
            </div>
            <div class="hud-block">
              <div class="label">스코어</div>
              <div class="value" id="score">0</div>
            </div>
            <div class="hud-block">
              <div class="label">레벨</div>
              <div class="value" id="level">1</div>
            </div>
            <div class="hud-block">
              <div class="label">줄</div>
              <div class="value" id="lines">0</div>
            </div>
            <div class="hud-block">
              <div class="label">콤보</div>
              <div class="value" id="combo">-</div>
            </div>
          </div>
          <canvas id="board" width="${BOARD_COLS * TILE}" height="${(BOARD_ROWS + HIDDEN_ROWS) * TILE}"></canvas>
          <div class="board-overlay" id="board-overlay"></div>
          <div class="floating" id="effects"></div>
        </section>

        <aside class="sidebar">
          <div class="card">
            <div class="card-title">다음 블록</div>
            <canvas id="next"></canvas>
          </div>
          <div class="card">
            <div class="card-title">이번 게임 랭킹</div>
            <ul id="ranking" class="ranking"></ul>
          </div>
          <div class="card">
            <div class="card-title">상점</div>
            <div class="store">
              <button data-pack="1" class="pill">하트 1개 · $1</button>
              <button data-pack="3" class="pill">하트 3개 · $3</button>
              <button data-pack="unli" class="pill">1시간 무제한 · $5</button>
              <button data-pack="24h" class="pill">24시간 무제한 · $10</button>
              <button data-pack="30d" class="pill accent">1달 무제한 · $20</button>
            </div>
          </div>
          <div class="card">
            <div class="card-title">테마</div>
            <div class="theme-list" id="theme-list"></div>
          </div>
        </aside>
      </div>

      <section class="controls">
        <div class="control-pad" id="pad-left">
          <button data-action="left">◀</button>
          <button data-action="soft">▼</button>
          <button data-action="right">▶</button>
        </div>
        <div class="control-pad" id="pad-right">
          <button data-action="rotate-left">⟲</button>
          <button data-action="hard">⏬</button>
          <button data-action="rotate-right">⟳</button>
        </div>
      </section>
    </div>

    <!-- Store Modal -->
    <div id="store-modal" class="modal">
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h2>하트 상점</h2>
          <button class="modal-close" data-modal-close="store-modal">&times;</button>
        </div>
        <div class="modal-products">
          <button class="modal-product-pill" data-pack="1">
            <div class="pill-amount">❤️ 1개</div>
            <div class="pill-price">$1</div>
          </button>
          <button class="modal-product-pill" data-pack="3">
            <div class="pill-amount">❤️❤️❤️ 3개</div>
            <div class="pill-price">$3</div>
          </button>
          <button class="modal-product-pill" data-pack="unli">
            <div class="pill-amount">⚡ 1시간 무제한</div>
            <div class="pill-price">$5</div>
          </button>
          <button class="modal-product-pill" data-pack="24h">
            <div class="pill-amount">⚡ 24시간 무제한</div>
            <div class="pill-price">$10</div>
          </button>
          <button class="modal-product-pill accent" data-pack="30d">
            <div class="pill-amount">⚡ 1달 무제한</div>
            <div class="pill-price">$20</div>
          </button>
        </div>
      </div>
    </div>

    <!-- Purchase Modal (when hearts empty) -->
    <div id="purchase-modal" class="modal">
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h2>하트가 없어요!</h2>
          <button class="modal-close" data-modal-close="purchase-modal">&times;</button>
        </div>
        <p class="modal-message">지금 구매하고 게임을 계속하세요!</p>
        <div class="modal-products">
          <button class="modal-product-pill" data-pack="1">
            <div class="pill-amount">❤️ 1개</div>
            <div class="pill-price">$1</div>
          </button>
          <button class="modal-product-pill" data-pack="3">
            <div class="pill-amount">❤️❤️❤️ 3개</div>
            <div class="pill-price">$3</div>
          </button>
          <button class="modal-product-pill" data-pack="unli">
            <div class="pill-amount">⚡ 1시간 무제한</div>
            <div class="pill-price">$5</div>
          </button>
          <button class="modal-product-pill" data-pack="24h">
            <div class="pill-amount">⚡ 24시간 무제한</div>
            <div class="pill-price">$10</div>
          </button>
          <button class="modal-product-pill accent" data-pack="30d">
            <div class="pill-amount">⚡ 1달 무제한</div>
            <div class="pill-price">$20</div>
          </button>
        </div>
      </div>
    </div>

    <!-- Revive Modal (game over) -->
    <div id="revive-modal" class="modal">
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h2>게임 오버!</h2>
        </div>
        <p class="modal-message"><span id="revive-score">0</span>점을 얻었습니다!</p>
        <div class="modal-buttons">
          <button class="modal-action-btn continue" id="revive-continue-btn">
            <div>❤️ 계속하기</div>
            <div class="pill-price" id="revive-cost">하트 1개 사용</div>
          </button>
          <button class="modal-action-btn restart" id="revive-restart-btn">메인으로</button>
        </div>
      </div>
    </div>

    <!-- Pause Modal -->
    <div id="pause-modal" class="modal">
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h2>일시정지</h2>
          <button class="modal-close" data-modal-close="pause-modal">&times;</button>
        </div>
        <p class="modal-message">게임이 일시정지되었습니다.</p>
        <div class="modal-buttons">
          <button class="modal-action-btn continue" id="pause-continue-btn">계속하기</button>
          <button class="modal-action-btn restart" id="pause-quit-btn">게임 종료 (메인 메뉴)</button>
        </div>
      </div>
    </div>
  </div>
`

const boardCanvas = document.querySelector<HTMLCanvasElement>('#board')!
const nextCanvas = document.querySelector<HTMLCanvasElement>('#next')!
const ctx = boardCanvas.getContext('2d')!
const nextCtx = nextCanvas.getContext('2d')!
const scoreEl = document.querySelector<HTMLDivElement>('#score')!
const levelEl = document.querySelector<HTMLDivElement>('#level')!
const linesEl = document.querySelector<HTMLDivElement>('#lines')!
const comboEl = document.querySelector<HTMLDivElement>('#combo')!
const modeDisplayEl = document.querySelector<HTMLDivElement>('#mode-display')!
const heartsEl = document.querySelector<HTMLDivElement>('#hearts')!
const rechargeEl = document.querySelector<HTMLDivElement>('#recharge')!
const menuHeartsEl = document.querySelector<HTMLDivElement>('#menu-hearts')!
const menuRechargeEl = document.querySelector<HTMLDivElement>('#menu-recharge')!
const rankingEl = document.querySelector<HTMLUListElement>('#ranking')!
const menuRankingEl = document.querySelector<HTMLUListElement>('#menu-ranking')!
const effectsEl = document.querySelector<HTMLDivElement>('#effects')!
const boardOverlay = document.querySelector<HTMLDivElement>('#board-overlay')!
const loadingLayer = document.querySelector<HTMLDivElement>('#loading')!
const loadingBar = document.querySelector<HTMLSpanElement>('#loading-bar')!
const loadingText = document.querySelector<HTMLDivElement>('#loading-text')!
const themeListEl = document.querySelector<HTMLDivElement>('#theme-list')!
const themeBtn = document.querySelector<HTMLButtonElement>('#theme-btn')!
const storeBtn = document.querySelector<HTMLButtonElement>('#store-btn')!
const menuStoreBtn = document.querySelector<HTMLButtonElement>('#menu-store-btn')!
const menuThemeBtn = document.querySelector<HTMLButtonElement>('#menu-theme-btn')!
const menuBtn = document.querySelector<HTMLButtonElement>('#menu-btn')!
const menuScreen = document.querySelector<HTMLDivElement>('#menu-screen')!
const gameScreen = document.querySelector<HTMLDivElement>('#game-screen')!
const rankingTabs = document.querySelector<HTMLDivElement>('#ranking-tabs')!

const state: GameState = {
  grid: createGrid(),
  active: undefined,
  nextQueue: [],
  hold: undefined,
  holdLocked: false,
  score: 0,
  combo: 0,
  lines: 0,
  level: 1,
  dropInterval: 900,
  dropTimer: 0,
  mode: 'classic',
  running: 'loading',
  effects: [],
  garbageTimer: 0,
  gravityTimer: 0,
  speedTimer: 0,
  multiplier: 1,
  screen: 'menu',
  reviveUsed: false,
  clearingLines: [],
  gravityDropping: false
}

let lastTime = 0
let bag: PieceKey[] = []
let heartState: HeartState = loadHearts()
// 테스트: 1시간 무제한 추가
heartState.unlimitedUntil = Date.now() + 60 * 60 * 1000

applyTheme(loadTheme())
renderThemeList()
void renderRanking()
renderHearts()
renderRecharge()
void renderMenuRanking('all')
bindModeCards()
bindRankingTabs()
updateScreenVisibility()
ensureBillingReady().catch((e) => console.warn('Billing init failed', e))

const resizeObserver = new ResizeObserver(() => {
  boardOverlay.style.width = `${boardCanvas.clientWidth}px`
  boardOverlay.style.height = `${boardCanvas.clientHeight}px`
})
resizeObserver.observe(boardCanvas)

// Resize next canvas to match container
const nextResizeObserver = new ResizeObserver(() => {
  const rect = nextCanvas.getBoundingClientRect()
  nextCanvas.width = rect.width
  nextCanvas.height = rect.height
  drawNext()
})
nextResizeObserver.observe(nextCanvas)

simulateLoading().then(() => {
  state.running = 'ready'
  state.screen = 'menu'
  updateScreenVisibility()
})

requestAnimationFrame(loop)
setInterval(tickHearts, 1000)

// ---------- UI building ----------

function updateScreenVisibility() {
  if (state.screen === 'menu') {
    menuScreen.style.display = 'block'
    gameScreen.style.display = 'none'
  } else {
    menuScreen.style.display = 'none'
    gameScreen.style.display = 'block'
  }
}

// ---------- Modal Management ----------

let purchaseModalMode: ModeKey = 'classic'

function showModal(modalId: string) {
  const modal = document.querySelector<HTMLDivElement>(`#${modalId}`)
  if (modal) {
    modal.style.display = 'flex'
  }
}

function hideModal(modalId: string) {
  const modal = document.querySelector<HTMLDivElement>(`#${modalId}`)
  if (modal) {
    modal.style.display = 'none'
  }
}

function bindModeCards() {
  document.querySelectorAll<HTMLDivElement>('.mode-card').forEach((card) => {
    card.addEventListener('click', () => {
      const mode = card.dataset.mode as ModeKey
      start(mode)
    })
  })
}

function bindRankingTabs() {
  rankingTabs.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      rankingTabs.querySelectorAll('button').forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      const mode = btn.dataset.mode as ModeKey | 'all'
      renderMenuRanking(mode)
    })
  })
}

async function renderRanking() {
  rankingEl.innerHTML = '<li style="color:var(--muted);text-align:center">불러오는 중...</li>'
  const rankings = await fetchRankings(state.mode, 5)
  rankingEl.innerHTML =
    rankings.length > 0
      ? rankings
          .map(
            (r, i) =>
              `<li><span>${i + 1}위</span><span>${r.name}</span><span>${abbreviateScore(r.score)}</span></li>`
          )
          .join('')
      : '<li style="text-align:center;color:var(--muted)">아직 기록이 없어요</li>'
}

async function renderMenuRanking(mode: ModeKey | 'all') {
  menuRankingEl.innerHTML = '<li style="color:var(--muted);text-align:center">불러오는 중...</li>'
  const rankings = await fetchRankings(mode, 10)
  menuRankingEl.innerHTML =
    rankings.length > 0
      ? rankings
          .map(
            (r, i) =>
              `<li><span>${i + 1}위</span><span>${r.name}</span><span>${getModeLabel(r.mode)}</span><span>${abbreviateScore(r.score)}</span></li>`
          )
          .join('')
      : '<li style="text-align:center;color:var(--muted);grid-column:1/-1">아직 기록이 없어요</li>'
}

function renderThemeList() {
  themeListEl.innerHTML = Object.entries(themes)
    .map(
      ([key, t]) => `
        <button class="pill" data-theme="${key}">${t.name}</button>
      `
    )
    .join('')
  themeListEl.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.theme as ThemeKey
      applyTheme(key)
      saveTheme(key)
    })
  })
}

// ---------- Game lifecycle ----------

function start(mode: ModeKey) {
  if (state.running === 'loading') return
  if (!hasHeart()) {
    showModal('purchase-modal')
    purchaseModalMode = mode
    return
  }

  consumeHeart()
  renderHearts()
  renderRecharge()

  state.grid = createGrid()
  state.score = 0
  state.lines = 0
  state.level = 1
  state.combo = 0
  state.multiplier = 1
  state.mode = mode
  state.effects = []
  state.dropInterval = mode === 'classic' ? 900 : mode === 'gravity' ? 850 : mode === 'online' ? 780 : 760
  state.dropTimer = 0
  state.garbageTimer = 0
  state.gravityTimer = 0
  state.speedTimer = 0
  state.clearingLines = []
  state.gravityDropping = false
  bag = []
  state.active = spawnPiece()
  state.nextQueue = [pickFromBag(), pickFromBag(), pickFromBag()]
  state.running = 'playing'
  state.hold = undefined
  state.holdLocked = false
  state.reviveUsed = false
  state.screen = 'game'
  boardOverlay.innerText = ''
  updateScreenVisibility()
}

function loop(timestamp: number) {
  const delta = timestamp - lastTime
  lastTime = timestamp

  if (state.running === 'playing') {
    state.dropTimer += delta
    state.garbageTimer += delta
    state.gravityTimer += delta
    state.speedTimer += delta

    const fallInterval = state.dropInterval / state.multiplier
    if (state.dropTimer >= fallInterval) {
      softStep()
      state.dropTimer = 0
    }

    if (state.mode === 'hard' && state.speedTimer >= 12000) {
      state.dropInterval = Math.max(250, state.dropInterval - 40)
      state.speedTimer = 0
    }
    if (state.mode === 'hard' && state.garbageTimer >= 9500) {
      pushGarbage()
      state.garbageTimer = 0
    }
    if (state.mode === 'gravity' && state.gravityTimer >= 4000) {
      pushGarbage()
      state.gravityTimer = 0
      state.gravityDropping = true
    }
    if (state.mode === 'online' && state.speedTimer >= 15000) {
      state.dropInterval = Math.max(320, state.dropInterval - 30)
      state.speedTimer = 0
    }
    if (state.mode === 'online' && state.garbageTimer >= 8000) {
      pushGarbage()
      state.garbageTimer = 0
    }
  }

  render()
  requestAnimationFrame(loop)
}

// ---------- Rendering ----------

function render() {
  drawBoard()
  drawNext()
  renderHUD()
  renderEffects()
}

function drawBoard() {
  ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height)
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim()
  ctx.fillStyle = gridColor
  ctx.fillRect(0, 0, boardCanvas.width, boardCanvas.height)

  // settled blocks
  for (let y = HIDDEN_ROWS; y < BOARD_ROWS + HIDDEN_ROWS; y++) {
    for (let x = 0; x < BOARD_COLS; x++) {
      const cell = state.grid[y]?.[x]
      if (cell) {
        // 터지는 라인이면 특별 효과
        if (state.clearingLines.includes(y)) {
          drawCell(x, y, cell, false, 0.5)
        } else {
          drawCell(x, y, cell)
        }
      }
    }
  }

  // active piece
  if (state.active) {
    const shape = currentShape()
    shape.forEach((row, dy) => {
      row.forEach((val, dx) => {
        if (!val) return
        const px = state.active!.position.x + dx
        const py = state.active!.position.y + dy
        drawCell(px, py, tetrominoes[state.active!.key].color, true)
      })
    })
  }
}

function drawCell(x: number, y: number, color: string | number, translucent = false, alpha = 0.9) {
  const px = x * TILE
  const py = y * TILE
  const fill = typeof color === 'number' ? '#fff' : color
  ctx.fillStyle = translucent ? toAlpha(fill, alpha) : toAlpha(fill, 1)
  ctx.strokeStyle = toAlpha('#000', 0.35)
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(px + 2, py + 2, TILE - 4, TILE - 4, 6)
  ctx.fill()
  ctx.stroke()
}

function drawNext() {
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height)
  state.nextQueue.slice(0, 3).forEach((key, i) => {
    const shape = tetrominoes[key].rotations[0]
    const tile = 22
    const offsetX = 10
    const offsetY = 10 + i * 55
    shape.forEach((row, y) => {
      row.forEach((val, x) => {
        if (!val) return
        nextCtx.fillStyle = tetrominoes[key].color
        nextCtx.strokeStyle = toAlpha('#000', 0.4)
        nextCtx.lineWidth = 2
        nextCtx.beginPath()
        nextCtx.roundRect(offsetX + x * tile, offsetY + y * tile, tile - 3, tile - 3, 5)
        nextCtx.fill()
        nextCtx.stroke()
      })
    })
  })
}

function renderHUD() {
  scoreEl.textContent = abbreviateScore(state.score)
  levelEl.textContent = state.level.toString()
  linesEl.textContent = state.lines.toString()
  comboEl.textContent = state.combo > 0 ? `x${state.combo}` : '-'
  if (modeDisplayEl) modeDisplayEl.textContent = getModeLabel(state.mode)
}

function renderEffects() {
  state.effects = state.effects.filter((e) => e.life > 0)
  effectsEl.innerHTML = state.effects
    .map((e) => {
      e.life -= 16
      return `<span style="left:${e.x}%;top:${e.y}%;opacity:${e.life / 600}">${e.label}</span>`
    })
    .join('')
}

// ---------- Game mechanics ----------

function createGrid(): Grid {
  return Array.from({ length: BOARD_ROWS + HIDDEN_ROWS }, () =>
    Array.from({ length: BOARD_COLS }, () => 0)
  )
}

function currentShape() {
  if (!state.active) return []
  const shape = tetrominoes[state.active.key]
  return shape.rotations[state.active.rotation % shape.rotations.length]
}

function pickFromBag(): PieceKey {
  if (bag.length === 0) {
    bag = shuffle(Object.keys(tetrominoes) as PieceKey[])
  }
  return bag.pop()!
}

function spawnPiece(): FallingPiece {
  const key = pickFromBag()
  return {
    key,
    rotation: 0,
    position: { x: Math.floor(BOARD_COLS / 2) - 2, y: 0 }
  }
}

function softStep() {
  if (!state.active) return
  if (!move({ x: 0, y: 1 })) {
    lockPiece()
  }
}

function move(delta: Vec2) {
  if (!state.active) return false
  const nextPos = { x: state.active.position.x + delta.x, y: state.active.position.y + delta.y }
  if (!collides(state.active, nextPos, state.active.rotation)) {
    state.active.position = nextPos
    return true
  }
  return false
}

function rotate(dir: number) {
  if (!state.active) return
  const piece = state.active
  const nextRotation = (piece.rotation + dir + 4) % tetrominoes[piece.key].rotations.length
  if (!collides(piece, piece.position, nextRotation)) {
    piece.rotation = nextRotation
    return
  }
  // naive wall kick left/right
  const kicks = [1, -1, 2, -2]
  for (const k of kicks) {
    if (!collides(piece, { x: piece.position.x + k, y: piece.position.y }, nextRotation)) {
      piece.position.x += k
      piece.rotation = nextRotation
      return
    }
  }
}

function collides(piece: FallingPiece, pos: Vec2, rotation: number) {
  const shape = tetrominoes[piece.key].rotations[rotation]
  for (let y = 0; y < shape.length; y++) {
    for (let x = 0; x < shape[y].length; x++) {
      if (!shape[y][x]) continue
      const nx = pos.x + x
      const ny = pos.y + y
      if (nx < 0 || nx >= BOARD_COLS || ny >= BOARD_ROWS + HIDDEN_ROWS) return true
      if (ny >= 0 && state.grid[ny][nx]) return true
    }
  }
  return false
}

function lockPiece() {
  if (!state.active) return
  const shape = currentShape()
  shape.forEach((row, y) => {
    row.forEach((val, x) => {
      if (!val) return
      const gx = state.active!.position.x + x
      const gy = state.active!.position.y + y
      if (gy < 0) {
        gameOver()
        return
      }
      state.grid[gy][gx] = tetrominoes[state.active!.key].color
    })
  })
  clearLines()
  state.active = makeNext()
  state.holdLocked = false
  state.dropTimer = 0
}

function clearLines() {
  const filled: number[] = []
  for (let y = 0; y < state.grid.length; y++) {
    if (state.grid[y].every((v) => v)) filled.push(y)
  }
  if (filled.length === 0) {
    state.combo = 0
    return
  }

  // Set clearing animation
  state.clearingLines = filled.slice()

  // Remove lines after a short delay for animation
  setTimeout(() => {
    filled.sort((a, b) => a - b)
    filled
      .slice()
      .reverse()
      .forEach((y) => state.grid.splice(y, 1))
    const cleared = filled.length

    // Gravity mode: the 3 lines above the first cleared row drop down further
    if (state.mode === 'gravity') {
      const firstCleared = filled[0]
      const zoneStart = Math.max(0, firstCleared - 3)
      state.gravityDropping = true
      for (let y = firstCleared - 1; y >= zoneStart; y--) {
        for (let x = 0; x < BOARD_COLS; x++) {
          const cell = state.grid[y][x]
          if (!cell) continue
          let ny = y
          while (ny + 1 < state.grid.length && state.grid[ny + 1][x] === 0) ny += 1
          if (ny !== y) {
            state.grid[ny][x] = cell
            state.grid[y][x] = 0
          }
        }
      }
      setTimeout(() => {
        state.gravityDropping = false
      }, 300)
    }

    while (state.grid.length < BOARD_ROWS + HIDDEN_ROWS) {
      state.grid.unshift(Array.from({ length: BOARD_COLS }, () => 0))
    }

    const baseScore = [0, 100, 300, 500, 800][cleared] ?? 1200
    state.combo += 1
    const comboBonus = state.combo > 1 ? state.combo * 25 : 0
    const newScore = (baseScore + comboBonus) * state.level
    state.score += newScore
    state.lines += cleared
    state.level = 1 + Math.floor(state.lines / 10)
    state.multiplier = 1 + Math.min(1.4, state.level * 0.05)

    addEffect(`+${abbreviateScore(newScore)}`, 12 + Math.random() * 60, 8 + Math.random() * 60)
    if (state.combo >= 2) addEffect(`x${state.combo}!`, 20 + Math.random() * 50, 25)

    state.clearingLines = []
  }, 180)
}

function makeNext() {
  const next = state.nextQueue.shift() ?? pickFromBag()
  state.nextQueue.push(pickFromBag())
  const piece: FallingPiece = {
    key: next,
    rotation: 0,
    position: { x: Math.floor(BOARD_COLS / 2) - 2, y: 0 }
  }
  if (collides(piece, piece.position, piece.rotation)) {
    gameOver()
  }
  return piece
}

function hardDrop() {
  if (!state.active) return
  let steps = 0
  while (move({ x: 0, y: 1 })) {
    steps += 1
  }
  state.score += steps * HARD_DROP_BONUS
  lockPiece()
}

function pushGarbage() {
  const hole = Math.floor(Math.random() * BOARD_COLS)
  state.grid.shift()
  const row = Array.from({ length: BOARD_COLS }, (_, i) => (i === hole ? 0 : '#2f3d5f'))
  state.grid.push(row)
}

function gameOver() {
  state.running = 'gameover'
  const reviveScoreEl = document.querySelector<HTMLSpanElement>('#revive-score')!
  reviveScoreEl.innerText = abbreviateScore(state.score)
  
  // 첫 번째 사망 - 부활 기회 제공
  if (!state.reviveUsed) {
    showModal('revive-modal')
  } else {
    // 두 번째 사망 - 바로 게임 종료 및 랭킹 등록
    hideModal('revive-modal')
    const name = prompt('최종 점수: ' + abbreviateScore(state.score) + '\n랭킹에 등록할 이름을 입력하세요:', '익명')
    if (name && name.trim()) {
      const entry: RankingEntry = {
        name: name.trim().slice(0, 12),
        score: state.score,
        mode: state.mode,
        date: Date.now()
      }
      void submitRanking(entry).then(() => void renderMenuRanking('all'))
    }
    returnToMenu()
  }
}

// ---------- Hearts ----------

function loadHearts(): HeartState {
  const saved = localStorage.getItem('tetoris-hearts')
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as HeartState
      return parsed
    } catch (e) {
      console.error(e)
    }
  }
  return { hearts: HEART_MAX, rechargeQueue: [] }
}

function saveHearts() {
  localStorage.setItem('tetoris-hearts', JSON.stringify(heartState))
}

function hasHeart() {
  if (heartState.unlimitedUntil && heartState.unlimitedUntil > Date.now()) return true
  return heartState.hearts > 0
}

function consumeHeart() {
  if (heartState.unlimitedUntil && heartState.unlimitedUntil > Date.now()) return
  if (heartState.hearts > 0) {
    heartState.hearts -= 1
    heartState.rechargeQueue.push(Date.now() + HEART_RECHARGE_MS)
    saveHearts()
  }
}

function tickHearts() {
  const now = Date.now()
  heartState.rechargeQueue = heartState.rechargeQueue.sort((a, b) => a - b)
  while (heartState.hearts < HEART_MAX && heartState.rechargeQueue[0] && heartState.rechargeQueue[0] <= now) {
    heartState.rechargeQueue.shift()
    heartState.hearts += 1
  }
  if (heartState.unlimitedUntil && heartState.unlimitedUntil <= now) {
    heartState.unlimitedUntil = undefined
  }
  renderHearts()
  renderRecharge()
  saveHearts()
}

function renderHearts() {
  const hearts = heartState.unlimitedUntil && heartState.unlimitedUntil > Date.now() ? HEART_MAX : heartState.hearts
  const unlimited = heartState.unlimitedUntil && heartState.unlimitedUntil > Date.now()
  const full = '❤'
  const empty = '♡'
  const text = unlimited ? '∞ (1시간 무제한)' : `${full.repeat(hearts)}${empty.repeat(HEART_MAX - hearts)}`
  heartsEl.textContent = text
  menuHeartsEl.textContent = text
}

function renderRecharge() {
  const now = Date.now()
  const next = heartState.rechargeQueue[0]
  let text = ''
  if (heartState.unlimitedUntil && heartState.unlimitedUntil > now) {
    const remain = heartState.unlimitedUntil - now
    text = `무제한 ${formatMs(remain)} 남음`
  } else if (!next) {
    text = '충전 대기 없음'
  } else {
    const remain = next - now
    text = `다음 하트 ${formatMs(remain)} 후 충전`
  }
  rechargeEl.textContent = text
  menuRechargeEl.textContent = text
}

// ---------- Input ----------

document.addEventListener('keydown', (e) => {
  if (state.running !== 'playing') return
  switch (e.key) {
    case 'ArrowLeft':
      move({ x: -1, y: 0 })
      break
    case 'ArrowRight':
      move({ x: 1, y: 0 })
      break
    case 'ArrowDown':
      if (move({ x: 0, y: 1 })) state.score += SOFT_DROP_MULTIPLIER
      break
    case 'ArrowUp':
    case 'x':
    case 'X':
      rotate(1)
      break
    case 'z':
    case 'Z':
      rotate(-1)
      break
    case ' ': {
      e.preventDefault()
      hardDrop()
      break
    }
    case 'c':
    case 'C':
      hold()
      break
  }
})

function bindPad(id: string) {
  const pad = document.querySelector<HTMLDivElement>(id)!
  pad.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
    btn.addEventListener('pointerdown', () => {
      const action = btn.dataset.action
      if (state.running !== 'playing') return
      if (action === 'left') move({ x: -1, y: 0 })
      if (action === 'right') move({ x: 1, y: 0 })
      if (action === 'soft') {
        if (move({ x: 0, y: 1 })) state.score += SOFT_DROP_MULTIPLIER
      }
      if (action === 'hard') hardDrop()
      if (action === 'rotate-left') rotate(-1)
      if (action === 'rotate-right') rotate(1)
    })
  })
}

bindPad('#pad-left')
bindPad('#pad-right')

// ---------- Hold ----------

function hold() {
  if (!state.active || state.holdLocked) return
  const currentKey = state.active.key
  if (state.hold) {
    state.active = {
      key: state.hold,
      rotation: 0,
      position: { x: Math.floor(BOARD_COLS / 2) - 2, y: 0 }
    }
    state.hold = currentKey
  } else {
    state.hold = currentKey
    state.active = makeNext()
  }
  state.holdLocked = true
}

// ---------- Store + Theme ----------

function returnToMenu() {
  state.screen = 'menu'
  state.running = 'ready'
  updateScreenVisibility()
  renderMenuRanking('all')
  boardOverlay.innerText = ''
}

menuBtn.addEventListener('click', () => {
  if (state.running === 'playing') {
    openPauseModal()
  } else if (state.running === 'paused') {
    resumeGame()
  } else {
    returnToMenu()
  }
})

storeBtn.addEventListener('click', () => {
  if (state.running === 'playing') {
    pauseGame()
    showModal('store-modal')
  }
})

menuStoreBtn.addEventListener('click', () => {
  // 메뉴에서도 게임이 진행 중일 수 있으므로 잠시 일시정지 상태로 전환
  if (state.running === 'playing') pauseGame()
  showModal('store-modal')
})

function pauseGame(message = '') {
  if (state.running !== 'playing') return
  state.running = 'paused'
  boardOverlay.innerText = message
}

function openPauseModal() {
  pauseGame('일시정지')
  showModal('pause-modal')
}

function resumeGame() {
  if (state.running !== 'paused') return
  state.running = 'playing'
  hideModal('pause-modal')
  boardOverlay.innerText = ''
}

// Modal close buttons
document.querySelectorAll<HTMLButtonElement>('[data-modal-close]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const modalId = btn.dataset.modalClose!
    hideModal(modalId)
    if (modalId === 'pause-modal' || modalId === 'store-modal') {
      resumeGame()
    }
  })
})

// Modal backdrop close
document.querySelectorAll<HTMLDivElement>('.modal-backdrop').forEach((backdrop) => {
  backdrop.addEventListener('click', () => {
    const modal = backdrop.closest('.modal')
    if (modal) {
      hideModal(modal.id)
      if (modal.id === 'pause-modal' || modal.id === 'store-modal') {
        resumeGame()
      }
    }
  })
})

// Store modal product buttons
document.querySelectorAll<HTMLButtonElement>('.modal-product-pill').forEach((btn) => {
  btn.addEventListener('click', () => {
    const pack = btn.dataset.pack!
    handleStorePurchase(pack)
  })
})

// Pause modal buttons
document.querySelector<HTMLButtonElement>('#pause-continue-btn')?.addEventListener('click', () => {
  resumeGame()
})

document.querySelector<HTMLButtonElement>('#pause-quit-btn')?.addEventListener('click', () => {
  hideModal('pause-modal')
  returnToMenu()
})

// Revive modal buttons
document.querySelector<HTMLButtonElement>('#revive-continue-btn')?.addEventListener('click', () => {
  if (!hasHeart()) {
    alert('하트가 없어요!')
    return
  }
  consumeHeart()
  renderHearts()
  renderRecharge()
  state.reviveUsed = true
  state.running = 'playing'
  hideModal('revive-modal')
  boardOverlay.innerText = ''
})

document.querySelector<HTMLButtonElement>('#revive-restart-btn')?.addEventListener('click', () => {
  hideModal('revive-modal')
  const name = prompt('이 기록을 랭킹에 등록할 이름을 입력하세요:', '익명')
  if (name && name.trim()) {
    const entry: RankingEntry = {
      name: name.trim().slice(0, 12),
      score: state.score,
      mode: state.mode,
      date: Date.now()
    }
    void submitRanking(entry).then(() => void renderMenuRanking('all'))
  }
  returnToMenu()
})

// Purchase modal - after purchase, try to start the game again
function handleStorePurchase(pack: string) {
  const productId = PRODUCT_MAP[pack]
  if (!productId) return
  purchaseProduct(productId)
    .then(() => {
      applyPurchase(productId)
      hideModal('store-modal')
      hideModal('purchase-modal')
      if (state.running === 'paused') resumeGame()
      // If we were in purchase modal flow, retry starting the game
      if (purchaseModalMode && state.screen === 'menu') {
        start(purchaseModalMode)
      }
    })
    .catch((err) => {
      console.warn('Billing purchase failed', err)
      alert('결제에 실패했습니다. 다시 시도해주세요.')
      hideModal('store-modal')
      hideModal('purchase-modal')
      if (state.running === 'paused') resumeGame()
    })
}

// Bind sidebar store buttons
document.querySelectorAll<HTMLButtonElement>('.store .pill').forEach((btn) => {
  btn.addEventListener('click', () => {
    const pack = btn.dataset.pack!
    handleStorePurchase(pack)
  })
})

function cycleTheme() {
  const keys = Object.keys(themes) as ThemeKey[]
  const current = loadTheme()
  const idx = keys.indexOf(current)
  const next = keys[(idx + 1) % keys.length]
  applyTheme(next)
  saveTheme(next)
}

themeBtn.addEventListener('click', cycleTheme)
menuThemeBtn.addEventListener('click', cycleTheme)

function applyPurchase(productId: BillingProductId) {
  const now = Date.now()
  if (productId === 'heart_1') {
    heartState.hearts = Math.min(HEART_MAX, heartState.hearts + 1)
  }
  if (productId === 'heart_3') {
    heartState.hearts = HEART_MAX
  }
  if (productId === 'heart_1h') {
    heartState.unlimitedUntil = now + 60 * 60 * 1000
  }
  if (productId === 'heart_24h') {
    heartState.unlimitedUntil = now + 24 * 60 * 60 * 1000
  }
  if (productId === 'heart_30d') {
    heartState.unlimitedUntil = now + 30 * 24 * 60 * 60 * 1000
  }
  heartState.rechargeQueue = []
  saveHearts()
  renderHearts()
  renderRecharge()
}

// ---------- Helpers ----------

function abbreviateScore(value: number): string {
  if (value < 1000) return `${value}`
  let n = value
  let power = 0
  while (n >= 1000) {
    n /= 1000
    power += 1
  }
  const suffix = toAlphabet(power)
  const trimmed = n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)
  return `${trimmed}${suffix}`
}

function toAlphabet(n: number): string {
  let num = n
  let out = ''
  while (num > 0) {
    num -= 1
    out = String.fromCharCode(97 + (num % 26)) + out
    num = Math.floor(num / 26)
  }
  return out || 'a'
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function toAlpha(hex: string, alpha: number) {
  const c = hex.replace('#', '')
  const bigint = parseInt(c, 16)
  const r = (bigint >> 16) & 255
  const g = (bigint >> 8) & 255
  const b = bigint & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function formatMs(ms: number) {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function addEffect(label: string, xPercent: number, yPercent: number) {
  state.effects.push({
    id: crypto.randomUUID(),
    label,
    x: xPercent,
    y: yPercent,
    life: 600
  })
}

function formatDateTime(date: number) {
  const d = new Date(date)
  return `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}`
}

function applyTheme(key: ThemeKey) {
  const theme = themes[key]
  Object.entries(theme.vars).forEach(([k, v]) => document.documentElement.style.setProperty(k, v))
}

function saveTheme(key: ThemeKey) {
  localStorage.setItem('tetoris-theme', key)
}

function loadTheme(): ThemeKey {
  const saved = localStorage.getItem('tetoris-theme') as ThemeKey | null
  return saved ?? 'neon'
}

async function simulateLoading() {
  state.running = 'loading'
  let progress = 0
  return new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      progress = Math.min(100, progress + Math.random() * 18)
      loadingBar.style.width = `${progress}%`
      loadingText.textContent = progress < 100 ? `로딩 중... ${progress.toFixed(0)}%` : '준비 완료'
      if (progress >= 100) {
        clearInterval(timer)
        loadingLayer.classList.add('hidden')
        resolve()
      }
    }, 160)
  })
}

function loadRankings(): RankingEntry[] {
  const saved = localStorage.getItem('tetoris-rankings')
  if (saved) {
    try {
      return JSON.parse(saved) as RankingEntry[]
    } catch (e) {
      console.error(e)
    }
  }
  return []
}

function saveRankings(rankings: RankingEntry[]) {
  localStorage.setItem('tetoris-rankings', JSON.stringify(rankings))
}

function addRanking(entry: RankingEntry) {
  const rankings = loadRankings()
  rankings.push(entry)
  rankings.sort((a, b) => b.score - a.score)
  saveRankings(rankings.slice(0, 100))
}

async function fetchRankings(mode: ModeKey | 'all', limit: number): Promise<RankingEntry[]> {
  const client = getSupabase()
  const local = loadRankings()
  const localFiltered = mode === 'all' ? local : local.filter((r) => r.mode === mode)
  if (!client) return localFiltered.slice(0, limit)

  const query = client
    .from('rankings')
    .select('name, score, mode, created_at')
    .order('score', { ascending: false })
    .limit(limit)
  if (mode !== 'all') query.eq('mode', mode)

  const { data, error } = await query
  if (error || !data) {
    console.warn('랭킹 불러오기 실패, 로컬로 대체', error)
    return localFiltered.slice(0, limit)
  }
  return data.map((row) => ({
    name: row.name ?? '무명',
    score: row.score ?? 0,
    mode: (row.mode as ModeKey) ?? 'classic',
    date: row.created_at ? Date.parse(row.created_at as string) : Date.now()
  }))
}

async function submitRanking(entry: RankingEntry) {
  addRanking(entry)
  const client = getSupabase()
  if (!client) return
  const { error } = await client.from('rankings').insert({
    name: entry.name,
    score: entry.score,
    mode: entry.mode,
    created_at: new Date(entry.date).toISOString()
  })
  if (error) console.warn('랭킹 업로드 실패(로컬 저장됨)', error)
}

function getModeLabel(mode: ModeKey): string {
  const labels: Record<ModeKey, string> = {
    classic: '클래식',
    hard: '하드',
    gravity: '그래비티',
    online: '온라인'
  }
  return labels[mode]
}

// expose for debug
;(window as any).tetoris = { state, start, hold, hardDrop, formatDateTime, loadRankings, addRanking }
