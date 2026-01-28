import './style.css'
import { ensureBillingReady, purchaseProduct } from './billing'
import type { BillingProductId } from './billing'
import { getSupabase } from './supabaseClient'
import {
  initAuth,
  getCurrentUser,
  isAuthenticated,
  signInWithGoogle,
  signUpWithEmail,
  signInWithEmail,
  signOut,
  onAuthStateChange,
  type AuthUser
} from './auth'
import {
  type Match,
  type NetworkGameState,
  type MatchResult,
  type PlayerRank,
  getOrCreatePlayerRank,
  useOnlineHeart,
  getOnlineHearts,
  getRankDisplayString,
  joinMatchmaking,
  leaveMatchmaking,
  initBattleGame,
  connectBattle,
  sendReady,
  onLinesCleared as battleOnLinesCleared,
  applyPendingGarbage,
  getPendingGarbage,
  onMyGameOver as battleOnMyGameOver,
  cleanupBattle,
  getBattleSettings,
  isInBattle,
} from './online'

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
  country?: string
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
const SOFT_DROP_MULTIPLIER = 18
const HARD_DROP_BONUS = 6
const HEART_MAX = 5
const HEART_RECHARGE_MS = 30 * 60 * 1000
const PRODUCT_MAP: Record<string, BillingProductId> = {
  '1': 'heart_1',
  '3': 'heart_3',
  unli: 'heart_1h',
  '24h': 'heart_24h',
  '30d': 'heart_30d'
}

const RANKINGS_PER_PAGE = 10
let currentRankingPage = 0
let totalRankingPages = 0
let currentRankingMode: ModeKey | 'all' = 'all'

// ---------- Sound System ----------
class SoundManager {
  private audioContext: AudioContext | null = null
  private bgmGainNode: GainNode | null = null
  private sfxGainNode: GainNode | null = null
  private bgmOscillators: OscillatorNode[] = []
  private bgmPlaying = false
  private _bgmEnabled = true
  private _sfxEnabled = true

  get bgmEnabled() { return this._bgmEnabled }
  get sfxEnabled() { return this._sfxEnabled }

  init() {
    if (this.audioContext) return
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()

    // Create gain nodes for volume control
    this.bgmGainNode = this.audioContext.createGain()
    this.bgmGainNode.gain.value = 0.3
    this.bgmGainNode.connect(this.audioContext.destination)

    this.sfxGainNode = this.audioContext.createGain()
    this.sfxGainNode.gain.value = 0.5
    this.sfxGainNode.connect(this.audioContext.destination)

    // Load settings from localStorage
    const settings = localStorage.getItem('tetoris-sound-settings')
    if (settings) {
      const parsed = JSON.parse(settings)
      this._bgmEnabled = parsed.bgm ?? true
      this._sfxEnabled = parsed.sfx ?? true
    }
  }

  private saveSettings() {
    localStorage.setItem('tetoris-sound-settings', JSON.stringify({
      bgm: this._bgmEnabled,
      sfx: this._sfxEnabled
    }))
  }

  toggleBGM() {
    this._bgmEnabled = !this._bgmEnabled
    this.saveSettings()
    if (this._bgmEnabled) {
      this.startBGM()
    } else {
      this.stopBGM()
    }
    return this._bgmEnabled
  }

  toggleSFX() {
    this._sfxEnabled = !this._sfxEnabled
    this.saveSettings()
    return this._sfxEnabled
  }

  startBGM() {
    if (!this.audioContext || !this.bgmGainNode || !this._bgmEnabled || this.bgmPlaying) return
    this.bgmPlaying = true
    this.playBGMLoop()
  }

  private playBGMLoop() {
    if (!this.audioContext || !this.bgmGainNode || !this.bgmPlaying) return

    // Simple retro-style BGM using oscillators
    const now = this.audioContext.currentTime
    const bpm = 140
    const beatDuration = 60 / bpm

    // Tetris-inspired melody pattern (simplified)
    const melody = [
      { note: 659, duration: 1 },   // E5
      { note: 494, duration: 0.5 }, // B4
      { note: 523, duration: 0.5 }, // C5
      { note: 587, duration: 1 },   // D5
      { note: 523, duration: 0.5 }, // C5
      { note: 494, duration: 0.5 }, // B4
      { note: 440, duration: 1 },   // A4
      { note: 440, duration: 0.5 }, // A4
      { note: 523, duration: 0.5 }, // C5
      { note: 659, duration: 1 },   // E5
      { note: 587, duration: 0.5 }, // D5
      { note: 523, duration: 0.5 }, // C5
      { note: 494, duration: 1.5 }, // B4
      { note: 523, duration: 0.5 }, // C5
      { note: 587, duration: 1 },   // D5
      { note: 659, duration: 1 },   // E5
      { note: 523, duration: 1 },   // C5
      { note: 440, duration: 1 },   // A4
      { note: 440, duration: 1 },   // A4
    ]

    let time = now
    melody.forEach(({ note, duration }) => {
      const osc = this.audioContext!.createOscillator()
      const gain = this.audioContext!.createGain()

      osc.type = 'square'
      osc.frequency.value = note

      gain.gain.setValueAtTime(0.15, time)
      gain.gain.exponentialRampToValueAtTime(0.01, time + duration * beatDuration * 0.9)

      osc.connect(gain)
      gain.connect(this.bgmGainNode!)

      osc.start(time)
      osc.stop(time + duration * beatDuration)

      this.bgmOscillators.push(osc)
      time += duration * beatDuration
    })

    // Schedule next loop
    const loopDuration = time - now
    setTimeout(() => {
      this.bgmOscillators = []
      if (this.bgmPlaying) this.playBGMLoop()
    }, loopDuration * 1000)
  }

  stopBGM() {
    this.bgmPlaying = false
    this.bgmOscillators.forEach(osc => {
      try { osc.stop() } catch (e) { /* already stopped */ }
    })
    this.bgmOscillators = []
  }

  // Hard drop impact sound
  playDrop() {
    if (!this.audioContext || !this.sfxGainNode || !this._sfxEnabled) return

    const osc = this.audioContext.createOscillator()
    const gain = this.audioContext.createGain()

    osc.type = 'square'
    osc.frequency.setValueAtTime(150, this.audioContext.currentTime)
    osc.frequency.exponentialRampToValueAtTime(50, this.audioContext.currentTime + 0.1)

    gain.gain.setValueAtTime(0.3, this.audioContext.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1)

    osc.connect(gain)
    gain.connect(this.sfxGainNode)

    osc.start()
    osc.stop(this.audioContext.currentTime + 0.1)
  }

  // Piece land sound (softer)
  playLand() {
    if (!this.audioContext || !this.sfxGainNode || !this._sfxEnabled) return

    const osc = this.audioContext.createOscillator()
    const gain = this.audioContext.createGain()

    osc.type = 'triangle'
    osc.frequency.setValueAtTime(200, this.audioContext.currentTime)
    osc.frequency.exponentialRampToValueAtTime(100, this.audioContext.currentTime + 0.05)

    gain.gain.setValueAtTime(0.2, this.audioContext.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.05)

    osc.connect(gain)
    gain.connect(this.sfxGainNode)

    osc.start()
    osc.stop(this.audioContext.currentTime + 0.05)
  }

  // Line clear sound
  playClear(lines: number) {
    if (!this.audioContext || !this.sfxGainNode || !this._sfxEnabled) return

    const baseFreq = lines >= 4 ? 523 : lines >= 2 ? 440 : 392 // C5, A4, G4

    for (let i = 0; i < Math.min(lines, 4); i++) {
      const osc = this.audioContext.createOscillator()
      const gain = this.audioContext.createGain()

      osc.type = 'square'
      osc.frequency.value = baseFreq * (1 + i * 0.25)

      const startTime = this.audioContext.currentTime + i * 0.05
      gain.gain.setValueAtTime(0.2, startTime)
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.15)

      osc.connect(gain)
      gain.connect(this.sfxGainNode)

      osc.start(startTime)
      osc.stop(startTime + 0.15)
    }
  }

  // Move sound
  playMove() {
    if (!this.audioContext || !this.sfxGainNode || !this._sfxEnabled) return

    const osc = this.audioContext.createOscillator()
    const gain = this.audioContext.createGain()

    osc.type = 'sine'
    osc.frequency.value = 300

    gain.gain.setValueAtTime(0.1, this.audioContext.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.03)

    osc.connect(gain)
    gain.connect(this.sfxGainNode)

    osc.start()
    osc.stop(this.audioContext.currentTime + 0.03)
  }

  // Rotate sound
  playRotate() {
    if (!this.audioContext || !this.sfxGainNode || !this._sfxEnabled) return

    const osc = this.audioContext.createOscillator()
    const gain = this.audioContext.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(400, this.audioContext.currentTime)
    osc.frequency.exponentialRampToValueAtTime(600, this.audioContext.currentTime + 0.05)

    gain.gain.setValueAtTime(0.15, this.audioContext.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.05)

    osc.connect(gain)
    gain.connect(this.sfxGainNode)

    osc.start()
    osc.stop(this.audioContext.currentTime + 0.05)
  }

  // Game over sound
  playGameOver() {
    if (!this.audioContext || !this.sfxGainNode || !this._sfxEnabled) return

    const notes = [392, 349, 330, 294] // G4, F4, E4, D4
    notes.forEach((freq, i) => {
      const osc = this.audioContext!.createOscillator()
      const gain = this.audioContext!.createGain()

      osc.type = 'square'
      osc.frequency.value = freq

      const startTime = this.audioContext!.currentTime + i * 0.2
      gain.gain.setValueAtTime(0.2, startTime)
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.3)

      osc.connect(gain)
      gain.connect(this.sfxGainNode!)

      osc.start(startTime)
      osc.stop(startTime + 0.3)
    })
  }
}

const soundManager = new SoundManager()

// Battle mode state
let isBattleMode = false
let currentPlayerRank: PlayerRank | null = null
let matchmakingTimer: ReturnType<typeof setInterval> | null = null
let matchmakingStartTime = 0
let currentMatch: Match | null = null
let opponentBoardCtx: CanvasRenderingContext2D | null = null

const themes: Record<ThemeKey, Theme> = {
  neon: {
    name: 'Neon Pop',
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
    name: 'Midnight',
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
    name: 'Sand',
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
    name: 'Mint',
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
if (!app) throw new Error('App root not found.')

app.innerHTML = `
  <div class="shell">
    <div class="loading" id="loading">
      <div class="loading-logo">Drop the Cube</div>
      <p>Exciting cube-dropping action - Drop the Cube</p>
      <div class="loading-bar"><span id="loading-bar"></span></div>
      <div class="loading-text" id="loading-text">Preparing to load...</div>
    </div>

    <div class="menu-screen" id="menu-screen" role="main">
      <div class="menu-header">
        <div class="menu-logo" role="heading" aria-level="1">Drop the Cube</div>
        <p class="menu-tagline">Exciting cube-dropping action - Drop the Cube</p>
      </div>
      <div class="mode-grid" role="group" aria-label="Select game mode">
        <button class="mode-card" data-mode="classic" aria-label="Classic Mode: Enjoy the original Drop the Cube at a steady speed">
          <div class="mode-icon" aria-hidden="true">📦</div>
          <div class="mode-title">Classic</div>
          <div class="mode-description">Enjoy the original Drop the Cube at a steady speed</div>
        </button>
        <button class="mode-card" data-mode="hard" aria-label="Hard Mode: Increasing speed with rising garbage for extreme challenge">
          <div class="mode-icon" aria-hidden="true">🔥</div>
          <div class="mode-title">Hard</div>
          <div class="mode-description">Increasing speed with rising garbage for extreme challenge</div>
        </button>
        <button class="mode-card" data-mode="gravity" aria-label="Gravity Mode: Top 3 rows fall when lines are cleared">
          <div class="mode-icon" aria-hidden="true">🌊</div>
          <div class="mode-title">Gravity</div>
          <div class="mode-description">Top 3 rows fall when lines are cleared</div>
        </button>
        <button class="mode-card" data-mode="online" aria-label="Online Mode: Intense ranked match experience">
          <div class="mode-icon" aria-hidden="true">⚡</div>
          <div class="mode-title">Online</div>
          <div class="mode-description">Intense ranked match experience</div>
        </button>
      </div>
      <div class="menu-bottom">
        <div class="menu-hearts">
          <div class="hearts" id="menu-hearts"></div>
          <div class="recharge" id="menu-recharge"></div>
        </div>
        <div class="menu-buttons">
          <button class="ghost" id="menu-store-btn">Heart Store</button>
          <button class="ghost" id="menu-theme-btn">Change Theme</button>
        </div>
      </div>
      <div class="menu-ranking">
        <h3><span aria-hidden="true">🏆</span> Hall of Fame</h3>
        <div class="ranking-tabs" id="ranking-tabs" role="tablist" aria-label="Ranking filter">
          <button data-mode="all" class="active">All</button>
          <button data-mode="classic">Classic</button>
          <button data-mode="hard">Hard</button>
          <button data-mode="gravity">Gravity</button>
          <button data-mode="online">Online</button>
        </div>
        <ul id="menu-ranking" class="ranking"></ul>
        <div class="ranking-pagination" id="ranking-pagination"></div>
      </div>
    </div>

    <div class="game-screen" id="game-screen" role="main">
      <header class="topbar">
        <div class="brand">
          <div class="wordmark">Drop the Cube</div>
          <div class="tagline">Stack, clear, and climb the ranks</div>
        </div>
        <div id="auth-container"></div>
        <div class="top-actions">
          <div class="hearts" id="hearts"></div>
          <div class="recharge" id="recharge"></div>
          <button class="ghost" id="menu-btn">Pause</button>
          <button class="ghost" id="store-btn">Heart Store</button>
          <button class="ghost" id="theme-btn">Theme</button>
          <button class="ghost sound-btn" id="bgm-btn" title="Toggle BGM">🎵</button>
          <button class="ghost sound-btn" id="sfx-btn" title="Toggle SFX">🔊</button>
        </div>
      </header>

      <div class="layout">
        <section class="board-panel">
          <div class="hud">
            <div class="hud-block">
              <div class="label">Mode</div>
              <div class="value" id="mode-display">-</div>
            </div>
            <div class="hud-block">
              <div class="label">Score</div>
              <div class="value" id="score">0</div>
            </div>
            <div class="hud-block">
              <div class="label">Level</div>
              <div class="value" id="level">1</div>
            </div>
            <div class="hud-block">
              <div class="label">Lines</div>
              <div class="value" id="lines">0</div>
            </div>
            <div class="hud-block">
              <div class="label">Combo</div>
              <div class="value" id="combo">-</div>
            </div>
          </div>
          <canvas id="board" width="${BOARD_COLS * TILE}" height="${(BOARD_ROWS + HIDDEN_ROWS) * TILE}" role="img" aria-label="Drop the Cube game board"></canvas>
          <div class="board-overlay" id="board-overlay"></div>
          <div class="floating" id="effects"></div>
        </section>

        <aside class="sidebar">
          <div class="card">
            <div class="card-title">Next Pieces</div>
            <canvas id="next" role="img" aria-label="Preview of upcoming pieces"></canvas>
          </div>
          <div class="card">
            <div class="card-title">Game Rankings</div>
            <ul id="ranking" class="ranking"></ul>
          </div>
          <div class="card">
            <div class="card-title">Store</div>
            <div class="store">
              <button data-pack="1" class="pill">1 Heart · $1</button>
              <button data-pack="3" class="pill">3 Hearts · $3</button>
              <button data-pack="unli" class="pill">1 Hour Unlimited · $5</button>
              <button data-pack="24h" class="pill">24 Hours Unlimited · $10</button>
              <button data-pack="30d" class="pill accent">30 Days Unlimited · $20</button>
            </div>
          </div>
          <div class="card">
            <div class="card-title">Theme</div>
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
    <div id="store-modal" class="modal" role="dialog" aria-labelledby="store-modal-title" aria-modal="true">
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h2 id="store-modal-title">Heart Store</h2>
          <button class="modal-close" data-modal-close="store-modal" aria-label="Close">&times;</button>
        </div>
        <div class="modal-products">
          <button class="modal-product-pill" data-pack="1">
            <div class="pill-amount">❤️ 1 Heart</div>
            <div class="pill-price">$1</div>
          </button>
          <button class="modal-product-pill" data-pack="3">
            <div class="pill-amount">❤️❤️❤️ 3 Hearts</div>
            <div class="pill-price">$3</div>
          </button>
          <button class="modal-product-pill" data-pack="unli">
            <div class="pill-amount">⚡ 1 Hour Unlimited</div>
            <div class="pill-price">$5</div>
          </button>
          <button class="modal-product-pill" data-pack="24h">
            <div class="pill-amount">⚡ 24 Hours Unlimited</div>
            <div class="pill-price">$10</div>
          </button>
          <button class="modal-product-pill accent" data-pack="30d">
            <div class="pill-amount">⚡ 30 Days Unlimited</div>
            <div class="pill-price">$20</div>
          </button>
        </div>
      </div>
    </div>

    <!-- Purchase Modal (when hearts empty) -->
    <div id="purchase-modal" class="modal" role="dialog" aria-labelledby="purchase-modal-title" aria-modal="true">
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h2 id="purchase-modal-title">Out of Hearts!</h2>
          <button class="modal-close" data-modal-close="purchase-modal" aria-label="Close">&times;</button>
        </div>
        <p class="modal-message">Purchase now to continue playing!</p>
        <div class="modal-products">
          <button class="modal-product-pill" data-pack="1">
            <div class="pill-amount">❤️ 1 Heart</div>
            <div class="pill-price">$1</div>
          </button>
          <button class="modal-product-pill" data-pack="3">
            <div class="pill-amount">❤️❤️❤️ 3 Hearts</div>
            <div class="pill-price">$3</div>
          </button>
          <button class="modal-product-pill" data-pack="unli">
            <div class="pill-amount">⚡ 1 Hour Unlimited</div>
            <div class="pill-price">$5</div>
          </button>
          <button class="modal-product-pill" data-pack="24h">
            <div class="pill-amount">⚡ 24 Hours Unlimited</div>
            <div class="pill-price">$10</div>
          </button>
          <button class="modal-product-pill accent" data-pack="30d">
            <div class="pill-amount">⚡ 30 Days Unlimited</div>
            <div class="pill-price">$20</div>
          </button>
        </div>
      </div>
    </div>

    <!-- Revive Modal (game over) -->
    <div id="revive-modal" class="modal" role="dialog" aria-labelledby="revive-modal-title" aria-modal="true">
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h2 id="revive-modal-title">Game Over!</h2>
        </div>
        <p class="modal-message">You scored <span id="revive-score">0</span> points!</p>
        <div class="modal-buttons">
          <button class="modal-action-btn continue" id="revive-continue-btn">
            <div>❤️ Continue</div>
            <div class="pill-price" id="revive-cost">Use 1 Heart</div>
          </button>
          <button class="modal-action-btn restart" id="revive-restart-btn">Back to Menu</button>
        </div>
      </div>
    </div>

    <!-- Pause Modal -->
    <div id="pause-modal" class="modal" role="dialog" aria-labelledby="pause-modal-title" aria-modal="true">
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h2 id="pause-modal-title">Paused</h2>
          <button class="modal-close" data-modal-close="pause-modal" aria-label="Close">&times;</button>
        </div>
        <p class="modal-message">Game is paused.</p>
        <div class="modal-buttons">
          <button class="modal-action-btn continue" id="pause-continue-btn">Continue</button>
          <button class="modal-action-btn restart" id="pause-quit-btn">Quit Game (Main Menu)</button>
        </div>
      </div>
    </div>

    <!-- Auth Modal -->
    <div id="auth-modal" class="modal" role="dialog" aria-labelledby="auth-modal-title" aria-modal="true">
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h2 id="auth-modal-title">Login Required</h2>
          <button class="modal-close" data-modal-close="auth-modal" aria-label="Close">&times;</button>
        </div>
        <p class="modal-message">Please log in to submit your score to the leaderboard</p>

        <div class="auth-tabs">
          <button class="auth-tab active" data-tab="login">Login</button>
          <button class="auth-tab" data-tab="signup">Sign Up</button>
        </div>

        <div id="auth-login-form" class="auth-form active">
          <button class="auth-google-btn" id="google-login-btn">
            <span class="google-icon">G</span>
            Continue with Google
          </button>

          <div class="auth-divider"><span>or</span></div>

          <input type="email" id="login-email" placeholder="Email" class="auth-input" />
          <input type="password" id="login-password" placeholder="Password" class="auth-input" />
          <button class="auth-submit-btn" id="login-submit-btn">Log In</button>
          <div class="auth-error" id="login-error"></div>
        </div>

        <div id="auth-signup-form" class="auth-form">
          <button class="auth-google-btn" id="google-signup-btn">
            <span class="google-icon">G</span>
            Continue with Google
          </button>

          <div class="auth-divider"><span>or</span></div>

          <input type="email" id="signup-email" placeholder="Email" class="auth-input" />
          <input type="password" id="signup-password" placeholder="Password (min 6 characters)" class="auth-input" />
          <button class="auth-submit-btn" id="signup-submit-btn">Sign Up</button>
          <div class="auth-error" id="signup-error"></div>
        </div>

        <button class="modal-action-btn" id="auth-guest-btn">Continue as Guest</button>
      </div>
    </div>

    <!-- Game Result Modal -->
    <div id="result-modal" class="modal" role="dialog" aria-labelledby="result-modal-title" aria-modal="true">
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h2 id="result-modal-title">Game Over</h2>
        </div>
        <div class="result-stats">
          <div class="result-score">
            <div class="result-label">Final Score</div>
            <div class="result-value" id="result-final-score">0</div>
          </div>
          <div class="result-details">
            <div class="result-detail">
              <span class="result-detail-label">Mode</span>
              <span class="result-detail-value" id="result-mode">Classic</span>
            </div>
            <div class="result-detail">
              <span class="result-detail-label">Lines</span>
              <span class="result-detail-value" id="result-lines">0</span>
            </div>
            <div class="result-detail">
              <span class="result-detail-label">Level</span>
              <span class="result-detail-value" id="result-level">1</span>
            </div>
          </div>
          <div class="result-ranking" id="result-ranking-section">
            <div class="result-label">Your Ranking</div>
            <div class="result-rank" id="result-rank">#-</div>
          </div>
        </div>
        <div class="modal-buttons">
          <button class="modal-action-btn continue" id="game-result-menu-btn">Back to Menu</button>
        </div>
      </div>
    </div>

    <!-- Battle Screen -->
    <div class="battle-screen" id="battle-screen">
      <div class="battle-header">
        <div class="battle-player-info">
          <div class="rank-badge" id="battle-p1-rank"></div>
          <div class="battle-player-name" id="battle-p1-name">Player 1</div>
          <div class="battle-player-stats" id="battle-p1-stats"></div>
        </div>
        <div class="battle-vs">VS</div>
        <div class="battle-player-info">
          <div class="rank-badge" id="battle-p2-rank"></div>
          <div class="battle-player-name" id="battle-p2-name">Player 2</div>
          <div class="battle-player-stats" id="battle-p2-stats"></div>
        </div>
      </div>

      <div class="battle-boards">
        <div class="battle-board my-board">
          <div class="battle-board-label">You</div>
          <canvas id="battle-my-board" width="${BOARD_COLS * TILE}" height="${(BOARD_ROWS + HIDDEN_ROWS) * TILE}"></canvas>
          <div class="garbage-meter"><div class="garbage-meter-fill"></div></div>
          <div class="battle-board-stats">
            <div class="battle-stat">
              <div class="battle-stat-label">Score</div>
              <div class="battle-stat-value" id="my-score">0</div>
            </div>
            <div class="battle-stat">
              <div class="battle-stat-label">Lines</div>
              <div class="battle-stat-value" id="my-lines">0</div>
            </div>
          </div>
        </div>

        <div class="battle-board opponent-board">
          <div class="battle-board-label">Opponent</div>
          <canvas id="opponent-board" width="${BOARD_COLS * 14}" height="${(BOARD_ROWS + HIDDEN_ROWS) * 14}"></canvas>
          <div class="battle-board-stats">
            <div class="battle-stat">
              <div class="battle-stat-label">Score</div>
              <div class="battle-stat-value" id="opp-score">0</div>
            </div>
            <div class="battle-stat">
              <div class="battle-stat-label">Lines</div>
              <div class="battle-stat-value" id="opp-lines">0</div>
            </div>
          </div>
        </div>
      </div>

      <div class="battle-countdown" id="battle-countdown">
        <div class="battle-countdown-number">3</div>
      </div>
    </div>

    <!-- Matchmaking Modal -->
    <div id="matchmaking-modal" class="modal">
      <div class="modal-backdrop"></div>
      <div class="modal-content matchmaking-content">
        <div class="matchmaking-header">
          <h2>Finding Opponent...</h2>
          <div class="matchmaking-rank"></div>
        </div>
        <div class="matchmaking-spinner"></div>
        <div class="matchmaking-timer" id="matchmaking-timer">0:00</div>
        <button class="matchmaking-cancel-btn" id="matchmaking-cancel-btn">Cancel</button>
      </div>
    </div>

    <!-- Battle Result Modal -->
    <div id="battle-result-modal" class="modal">
      <div class="modal-backdrop"></div>
      <div class="modal-content result-content">
        <div class="result-header">
          <h2 id="result-title">Victory!</h2>
        </div>
        <div class="result-stats">
          <div class="result-stat-row">
            <span class="result-stat-label">Final Score</span>
            <span class="result-stat-value" id="result-score">0</span>
          </div>
          <div class="result-stat-row">
            <span class="result-stat-label">Lines Cleared</span>
            <span class="result-stat-value" id="result-lines">0</span>
          </div>
          <div class="result-stat-row">
            <span class="result-stat-label">Garbage Sent</span>
            <span class="result-stat-value" id="result-garbage">0</span>
          </div>
        </div>
        <div class="result-rank-change">
          <div class="rank-badge" id="rank-before"></div>
          <div class="result-rank-arrow">&rarr;</div>
          <div class="rank-badge" id="rank-after"></div>
        </div>
        <div class="result-points-delta" id="points-change">+12</div>
        <div class="result-buttons">
          <button class="result-btn primary" id="result-play-again-btn">Play Again</button>
          <button class="result-btn secondary" id="result-menu-btn">Back to Menu</button>
        </div>
      </div>
    </div>
  </div>
`

// DOM Elements - will be initialized after DOM loads
let boardCanvas: HTMLCanvasElement
let nextCanvas: HTMLCanvasElement
let ctx: CanvasRenderingContext2D
let nextCtx: CanvasRenderingContext2D
let scoreEl: HTMLDivElement
let levelEl: HTMLDivElement
let linesEl: HTMLDivElement
let comboEl: HTMLDivElement
let modeDisplayEl: HTMLDivElement
let heartsEl: HTMLDivElement
let rechargeEl: HTMLDivElement
let menuHeartsEl: HTMLDivElement
let menuRechargeEl: HTMLDivElement
let rankingEl: HTMLUListElement
let menuRankingEl: HTMLUListElement
let effectsEl: HTMLDivElement
let boardOverlay: HTMLDivElement
let loadingLayer: HTMLDivElement
let loadingBar: HTMLSpanElement
let loadingText: HTMLDivElement
let themeListEl: HTMLDivElement
let themeBtn: HTMLButtonElement
let storeBtn: HTMLButtonElement
let menuStoreBtn: HTMLButtonElement
let menuThemeBtn: HTMLButtonElement
let menuBtn: HTMLButtonElement
let menuScreen: HTMLDivElement
let gameScreen: HTMLDivElement
let rankingTabs: HTMLDivElement

// Auth state
let currentUser: AuthUser | null = null
let authContainer: HTMLDivElement
let pendingRankingSubmission: RankingEntry | null = null

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
// // 테스트: 1시간 무제한 추가
// heartState.unlimitedUntil = Date.now() + 60 * 60 * 1000

function initializeDOM() {
  boardCanvas = document.querySelector<HTMLCanvasElement>('#board')!
  nextCanvas = document.querySelector<HTMLCanvasElement>('#next')!
  ctx = boardCanvas.getContext('2d')!
  nextCtx = nextCanvas.getContext('2d')!
  scoreEl = document.querySelector<HTMLDivElement>('#score')!
  levelEl = document.querySelector<HTMLDivElement>('#level')!
  linesEl = document.querySelector<HTMLDivElement>('#lines')!
  comboEl = document.querySelector<HTMLDivElement>('#combo')!
  modeDisplayEl = document.querySelector<HTMLDivElement>('#mode-display')!
  heartsEl = document.querySelector<HTMLDivElement>('#hearts')!
  rechargeEl = document.querySelector<HTMLDivElement>('#recharge')!
  menuHeartsEl = document.querySelector<HTMLDivElement>('#menu-hearts')!
  menuRechargeEl = document.querySelector<HTMLDivElement>('#menu-recharge')!
  rankingEl = document.querySelector<HTMLUListElement>('#ranking')!
  menuRankingEl = document.querySelector<HTMLUListElement>('#menu-ranking')!
  effectsEl = document.querySelector<HTMLDivElement>('#effects')!
  boardOverlay = document.querySelector<HTMLDivElement>('#board-overlay')!
  loadingLayer = document.querySelector<HTMLDivElement>('#loading')!
  loadingBar = document.querySelector<HTMLSpanElement>('#loading-bar')!
  loadingText = document.querySelector<HTMLDivElement>('#loading-text')!
  themeListEl = document.querySelector<HTMLDivElement>('#theme-list')!
  themeBtn = document.querySelector<HTMLButtonElement>('#theme-btn')!
  storeBtn = document.querySelector<HTMLButtonElement>('#store-btn')!
  menuStoreBtn = document.querySelector<HTMLButtonElement>('#menu-store-btn')!
  menuThemeBtn = document.querySelector<HTMLButtonElement>('#menu-theme-btn')!
  menuBtn = document.querySelector<HTMLButtonElement>('#menu-btn')!
  menuScreen = document.querySelector<HTMLDivElement>('#menu-screen')!
  gameScreen = document.querySelector<HTMLDivElement>('#game-screen')!
  rankingTabs = document.querySelector<HTMLDivElement>('#ranking-tabs')!
  authContainer = document.querySelector<HTMLDivElement>('#auth-container')!

  applyTheme(loadTheme())
  renderThemeList()
  void renderRanking()
  renderHearts()
  renderRecharge()
  void renderMenuRanking('all')
  bindModeCards()
  bindRankingTabs()
  bindBattleButtons()
  updateScreenVisibility()

  // Initialize auth BEFORE ensureBillingReady
  initAuth()
    .then(() => {
      currentUser = getCurrentUser()
      renderAuthUI()
      setupAuthListeners()
    })
    .catch(() => {})

  // Clear old rankings data (one-time migration)
  migrateRankingData()

  ensureBillingReady().catch(() => {})

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

  // Bind all event listeners
  bindEventListeners()

  simulateLoading().then(() => {
    state.running = 'ready'
    state.screen = 'menu'
    updateScreenVisibility()
  })

  requestAnimationFrame(loop)
  setInterval(tickHearts, 1000)
}

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

// ---------- Auth Management ----------

function migrateRankingData() {
  const hasCleared = localStorage.getItem('tetoris-rankings-cleared')
  if (!hasCleared) {
    localStorage.removeItem('tetoris-rankings')
    localStorage.setItem('tetoris-rankings-cleared', 'true')
  }
}

function renderAuthUI() {
  if (!authContainer) return

  if (currentUser) {
    const initial = currentUser.displayName?.charAt(0).toUpperCase() || '?'
    const avatar = currentUser.avatarUrl
      ? `<img src="${currentUser.avatarUrl}" class="user-avatar" alt="Avatar" />`
      : `<div class="user-avatar">${initial}</div>`

    authContainer.innerHTML = `
      <div class="user-info">
        ${avatar}
        <span class="user-name">${currentUser.displayName || 'Player'}</span>
        <button class="auth-btn" id="logout-btn">Logout</button>
      </div>
    `

    document.querySelector('#logout-btn')?.addEventListener('click', handleLogout)
  } else {
    authContainer.innerHTML = `
      <button class="auth-btn" id="login-btn">Login</button>
    `

    document.querySelector('#login-btn')?.addEventListener('click', () => showModal('auth-modal'))
  }
}

async function handleLogout() {
  try {
    await signOut()
    currentUser = null
    renderAuthUI()
  } catch (error) {
    console.error('Logout error:', error)
    alert('Failed to logout. Please try again.')
  }
}

function setupAuthListeners() {
  // Listen for auth state changes
  onAuthStateChange((user) => {
    currentUser = user
    renderAuthUI()
    reloadHeartsOnAuthChange()

    if (user && pendingRankingSubmission) {
      void submitAuthenticatedRanking(pendingRankingSubmission)
      pendingRankingSubmission = null
      hideModal('auth-modal')
    }
  })
}

async function handleGoogleLogin() {
  try {
    await signInWithGoogle()
  } catch (error: any) {
    showAuthError('login', error.message || 'Failed to login with Google')
  }
}

async function handleEmailLogin() {
  const emailInput = document.querySelector<HTMLInputElement>('#login-email')!
  const passwordInput = document.querySelector<HTMLInputElement>('#login-password')!
  const email = emailInput.value.trim()
  const password = passwordInput.value

  clearAuthError('login')

  if (!email || !password) {
    showAuthError('login', 'Please enter email and password')
    return
  }

  try {
    await signInWithEmail(email, password)
  } catch (error: any) {
    showAuthError('login', error.message || 'Invalid email or password')
  }
}

async function handleEmailSignup() {
  const emailInput = document.querySelector<HTMLInputElement>('#signup-email')!
  const passwordInput = document.querySelector<HTMLInputElement>('#signup-password')!
  const email = emailInput.value.trim()
  const password = passwordInput.value

  clearAuthError('signup')

  if (!email || !password) {
    showAuthError('signup', 'Please enter email and password')
    return
  }

  if (password.length < 6) {
    showAuthError('signup', 'Password must be at least 6 characters')
    return
  }

  try {
    await signUpWithEmail(email, password)
    showAuthError('signup', 'Check your email to confirm your account!', false)
    emailInput.value = ''
    passwordInput.value = ''
  } catch (error: any) {
    showAuthError('signup', error.message || 'Failed to sign up')
  }
}

function showAuthError(form: 'login' | 'signup', message: string, isError = true) {
  const errorEl = document.querySelector<HTMLDivElement>(`#${form}-error`)
  if (errorEl) {
    errorEl.textContent = message
    errorEl.style.color = isError ? '#ff6b6b' : '#4ade80'
  }
}

function clearAuthError(form: 'login' | 'signup') {
  const errorEl = document.querySelector<HTMLDivElement>(`#${form}-error`)
  if (errorEl) {
    errorEl.textContent = ''
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
  document.querySelectorAll<HTMLButtonElement>('.mode-card').forEach((card) => {
    card.addEventListener('click', () => {
      const mode = card.dataset.mode as ModeKey
      start(mode)
    })
  })
}

function bindBattleButtons() {
  // Matchmaking cancel button
  const cancelBtn = document.getElementById('matchmaking-cancel-btn')
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      void cancelMatchmaking()
    })
  }

  // Battle result buttons
  const playAgainBtn = document.getElementById('result-play-again-btn')
  if (playAgainBtn) {
    playAgainBtn.addEventListener('click', () => {
      closeBattleScreen()
      start('online')
    })
  }

  const menuBtn = document.getElementById('result-menu-btn')
  if (menuBtn) {
    menuBtn.addEventListener('click', () => {
      closeBattleScreen()
    })
  }
}

function bindRankingTabs() {
  rankingTabs.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      rankingTabs.querySelectorAll('button').forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      const mode = btn.dataset.mode as ModeKey | 'all'
      currentRankingPage = 0 // Reset to first page when changing tabs
      void renderMenuRanking(mode, 0)
    })
  })
}

async function renderRanking() {
  rankingEl.innerHTML = '<li style="color:var(--muted);text-align:center">Loading...</li>'
  const rankings = await fetchRankings(state.mode, 3)
  rankingEl.innerHTML =
    rankings.length > 0
      ? rankings
          .map(
            (r, i) =>
              `<li><span>#${i + 1}</span><span>${r.name}</span><span>${abbreviateScore(r.score)}</span></li>`
          )
          .join('')
      : '<li style="text-align:center;color:var(--muted);grid-column:1/-1">No records yet</li>'
}

async function renderMenuRanking(mode: ModeKey | 'all', page: number = 0) {
  currentRankingMode = mode
  currentRankingPage = page

  menuRankingEl.innerHTML = '<li style="color:var(--muted);text-align:center">Loading...</li>'

  // Fetch up to 100 rankings total
  const allRankings = await fetchRankings(mode, 100)
  totalRankingPages = Math.ceil(allRankings.length / RANKINGS_PER_PAGE)

  // Get current page rankings
  const startIdx = page * RANKINGS_PER_PAGE
  const endIdx = startIdx + RANKINGS_PER_PAGE
  const rankings = allRankings.slice(startIdx, endIdx)

  menuRankingEl.innerHTML =
    rankings.length > 0
      ? rankings
          .map(
            (r, i) =>
              `<li><span>#${startIdx + i + 1}</span><span>${r.country || '🌐'}</span><span>${r.name}</span><span>${getModeLabel(r.mode)}</span><span>${abbreviateScore(r.score)}</span></li>`
          )
          .join('')
      : '<li style="text-align:center;color:var(--muted);grid-column:1/-1">No records yet</li>'

  renderRankingPagination()
}

function renderRankingPagination() {
  const paginationEl = document.querySelector('#ranking-pagination')
  if (!paginationEl) return
  
  if (totalRankingPages <= 1) {
    paginationEl.innerHTML = ''
    return
  }
  
  const prevDisabled = currentRankingPage === 0
  const nextDisabled = currentRankingPage >= totalRankingPages - 1
  
  paginationEl.innerHTML = `
    <button id="ranking-prev" ${prevDisabled ? 'disabled' : ''}>◀</button>
    <span>${currentRankingPage + 1} / ${totalRankingPages}</span>
    <button id="ranking-next" ${nextDisabled ? 'disabled' : ''}>▶</button>
  `
  
  const prevBtn = document.querySelector<HTMLButtonElement>('#ranking-prev')
  const nextBtn = document.querySelector<HTMLButtonElement>('#ranking-next')
  
  if (prevBtn && !prevDisabled) {
    prevBtn.addEventListener('click', () => {
      void renderMenuRanking(currentRankingMode, currentRankingPage - 1)
    })
  }
  
  if (nextBtn && !nextDisabled) {
    nextBtn.addEventListener('click', () => {
      void renderMenuRanking(currentRankingMode, currentRankingPage + 1)
    })
  }
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

  // Online mode requires login and uses battle system
  if (mode === 'online') {
    startOnlineBattle()
    return
  }

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
  state.dropInterval = mode === 'classic' ? 900 : mode === 'gravity' ? 850 : 760
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
  void renderRanking()

  // Initialize and start sound
  soundManager.init()
  soundManager.startBGM()
}

// ---------- Online Battle Mode ----------

async function startOnlineBattle() {
  // Check authentication
  if (!isAuthenticated()) {
    showModal('auth-modal')
    return
  }

  const user = getCurrentUser()
  if (!user) return

  // Get or create player rank
  currentPlayerRank = await getOrCreatePlayerRank(user.id)
  if (!currentPlayerRank) {
    alert('Failed to load rank data')
    return
  }

  // Check online hearts
  const heartInfo = await getOnlineHearts(user.id)
  if (heartInfo.hearts <= 0) {
    showModal('purchase-modal')
    return
  }

  // Use online heart
  const heartUsed = await useOnlineHeart(user.id)
  if (!heartUsed) {
    alert('Failed to use heart')
    return
  }

  // Show matchmaking modal
  showMatchmakingModal()

  // Start matchmaking
  matchmakingStartTime = Date.now()
  updateMatchmakingTimer()
  matchmakingTimer = setInterval(updateMatchmakingTimer, 1000)

  await joinMatchmaking(
    { id: user.id, displayName: user.displayName || 'Player' },
    currentPlayerRank,
    {
      onMatchFound: handleMatchFound,
      onTimeout: handleMatchmakingTimeout,
      onError: handleMatchmakingError,
    }
  )
}

function showMatchmakingModal() {
  const modal = document.getElementById('matchmaking-modal')
  if (!modal) return

  const rankDisplay = modal.querySelector('.matchmaking-rank')
  if (rankDisplay && currentPlayerRank) {
    const tierClass = currentPlayerRank.tier.toLowerCase()
    rankDisplay.innerHTML = `
      <span class="rank-badge ${tierClass}">
        ${getRankDisplayString(currentPlayerRank.tier, currentPlayerRank.division)}
      </span>
    `
  }

  showModal('matchmaking-modal')
}

function updateMatchmakingTimer() {
  const timerEl = document.getElementById('matchmaking-timer')
  if (!timerEl) return

  const elapsed = Date.now() - matchmakingStartTime
  const seconds = Math.floor(elapsed / 1000)
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`
}

function stopMatchmakingTimer() {
  if (matchmakingTimer) {
    clearInterval(matchmakingTimer)
    matchmakingTimer = null
  }
}

async function cancelMatchmaking() {
  stopMatchmakingTimer()
  hideModal('matchmaking-modal')

  const user = getCurrentUser()
  if (user) {
    await leaveMatchmaking(user.id)
  }
}

async function handleMatchFound(match: Match) {
  stopMatchmakingTimer()
  hideModal('matchmaking-modal')

  currentMatch = match
  isBattleMode = true

  const user = getCurrentUser()
  if (!user) return

  // Initialize battle game
  initBattleGame(match, user.id, {
    onBattleStart: handleBattleStart,
    onBattleEnd: handleBattleEnd,
    onCountdownUpdate: handleCountdownUpdate,
    onOpponentStateUpdate: handleOpponentStateUpdate,
    onGarbageReceived: handleGarbageReceived,
    onOpponentDisconnect: handleOpponentDisconnect,
    onOpponentReconnect: handleOpponentReconnect,
  }, {
    getGameState: getNetworkGameState,
    getScore: () => state.score,
    getLines: () => state.lines,
  })

  // Connect to battle channel
  const connected = await connectBattle()
  if (!connected) {
    alert('Failed to connect to battle')
    isBattleMode = false
    currentMatch = null
    return
  }

  // Show battle screen
  showBattleScreen(match)

  // Send ready signal
  await sendReady()
}

function handleMatchmakingTimeout() {
  stopMatchmakingTimer()
  hideModal('matchmaking-modal')
  alert('Matchmaking timed out. Please try again.')
}

function handleMatchmakingError(error: Error) {
  stopMatchmakingTimer()
  hideModal('matchmaking-modal')
  alert(`Matchmaking error: ${error.message}`)
}

function showBattleScreen(match: Match) {
  const user = getCurrentUser()
  if (!user) return

  const isPlayer1 = match.player1Id === user.id
  const myName = isPlayer1 ? match.player1Name : match.player2Name
  const opponentName = isPlayer1 ? match.player2Name : match.player1Name

  // Update battle header
  const p1NameEl = document.getElementById('battle-p1-name')
  const p2NameEl = document.getElementById('battle-p2-name')
  if (p1NameEl) p1NameEl.textContent = myName
  if (p2NameEl) p2NameEl.textContent = opponentName

  // Show rank badges
  if (currentPlayerRank) {
    const p1RankEl = document.getElementById('battle-p1-rank')
    if (p1RankEl) {
      const tierClass = currentPlayerRank.tier.toLowerCase()
      p1RankEl.className = `rank-badge ${tierClass}`
      p1RankEl.textContent = getRankDisplayString(currentPlayerRank.tier, currentPlayerRank.division)
    }
  }

  // Initialize opponent canvas
  const opponentCanvas = document.getElementById('opponent-board') as HTMLCanvasElement
  if (opponentCanvas) {
    opponentBoardCtx = opponentCanvas.getContext('2d')
  }

  // Show battle screen, hide others
  const battleScreen = document.getElementById('battle-screen')
  const menuScreen = document.getElementById('menu-screen')
  const gameScreen = document.getElementById('game-screen')

  if (menuScreen) menuScreen.style.display = 'none'
  if (gameScreen) gameScreen.style.display = 'none'
  if (battleScreen) battleScreen.classList.add('active')

  // Show countdown overlay
  const countdownEl = document.getElementById('battle-countdown')
  if (countdownEl) countdownEl.classList.add('active')
}

function handleBattleStart() {
  // Hide countdown
  const countdownEl = document.getElementById('battle-countdown')
  if (countdownEl) countdownEl.classList.remove('active')

  // Initialize game state for battle
  const settings = getBattleSettings()

  state.grid = createGrid()
  state.score = 0
  state.lines = 0
  state.level = 1
  state.combo = 0
  state.multiplier = 1
  state.mode = 'online'
  state.effects = []
  state.dropInterval = settings.dropInterval
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
  state.reviveUsed = true // No revive in battle mode
}

function handleBattleEnd(result: MatchResult) {
  state.running = 'gameover'
  isBattleMode = false

  // Show result modal
  showBattleResultModal(result)
}

function showBattleResultModal(result: MatchResult) {
  const modal = document.getElementById('battle-result-modal')
  if (!modal) return

  const titleEl = modal.querySelector('#result-title') as HTMLElement
  if (titleEl) {
    titleEl.textContent = result.isWin ? 'Victory!' : 'Defeat'
    titleEl.className = result.isWin ? 'victory' : 'defeat'
  }

  const scoreEl = modal.querySelector('#result-score')
  if (scoreEl) scoreEl.textContent = abbreviateScore(result.myScore)

  const linesEl = modal.querySelector('#result-lines')
  if (linesEl) linesEl.textContent = String(result.myLines)

  const garbageEl = modal.querySelector('#result-garbage')
  if (garbageEl) garbageEl.textContent = String(result.garbageSent)

  // Rank change display
  const rankBeforeEl = modal.querySelector('#rank-before')
  const rankAfterEl = modal.querySelector('#rank-after')
  const pointsDeltaEl = modal.querySelector('#points-change')

  if (rankBeforeEl) {
    const tierClass = result.rankChange.before.tier.toLowerCase()
    rankBeforeEl.className = `rank-badge ${tierClass}`
    rankBeforeEl.textContent = getRankDisplayString(
      result.rankChange.before.tier,
      result.rankChange.before.division
    )
  }

  if (rankAfterEl) {
    const tierClass = result.rankChange.after.tier.toLowerCase()
    rankAfterEl.className = `rank-badge ${tierClass}`
    rankAfterEl.textContent = getRankDisplayString(
      result.rankChange.after.tier,
      result.rankChange.after.division
    )
  }

  if (pointsDeltaEl) {
    const delta = result.rankChange.pointsDelta
    pointsDeltaEl.textContent = delta >= 0 ? `+${delta}` : String(delta)
    pointsDeltaEl.className = `result-points-delta ${delta >= 0 ? 'positive' : 'negative'}`
  }

  showModal('battle-result-modal')
}

function handleCountdownUpdate(count: number) {
  const countdownEl = document.getElementById('battle-countdown')
  const numberEl = countdownEl?.querySelector('.battle-countdown-number')

  if (numberEl) {
    if (count > 0) {
      numberEl.textContent = String(count)
    } else {
      numberEl.textContent = 'GO!'
    }
  }
}

function handleOpponentStateUpdate(opponentState: NetworkGameState) {
  // Draw opponent's board
  if (!opponentBoardCtx) return

  const canvas = opponentBoardCtx.canvas
  const tileSize = canvas.width / BOARD_COLS

  opponentBoardCtx.clearRect(0, 0, canvas.width, canvas.height)

  const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim()
  opponentBoardCtx.fillStyle = gridColor
  opponentBoardCtx.fillRect(0, 0, canvas.width, canvas.height)

  // Draw opponent's grid
  for (let y = HIDDEN_ROWS; y < BOARD_ROWS + HIDDEN_ROWS; y++) {
    for (let x = 0; x < BOARD_COLS; x++) {
      const cell = opponentState.grid[y]?.[x]
      if (cell && typeof cell === 'string') {
        const px = x * tileSize
        const py = (y - HIDDEN_ROWS) * tileSize
        opponentBoardCtx.fillStyle = cell
        opponentBoardCtx.fillRect(px + 1, py + 1, tileSize - 2, tileSize - 2)
      }
    }
  }

  // Update opponent stats
  const oppScoreEl = document.getElementById('opp-score')
  const oppLinesEl = document.getElementById('opp-lines')
  if (oppScoreEl) oppScoreEl.textContent = abbreviateScore(opponentState.score)
  if (oppLinesEl) oppLinesEl.textContent = String(opponentState.lines)
}

function handleGarbageReceived(lines: number) {
  // Update garbage meter UI
  updateGarbageMeter()

  // Visual effect
  addEffect(`+${lines} garbage!`, 50, 80)
}

function updateGarbageMeter() {
  const pending = getPendingGarbage()
  const meterFill = document.querySelector('.garbage-meter-fill') as HTMLElement
  if (meterFill) {
    const maxHeight = 100
    const height = Math.min(maxHeight, (pending / 10) * maxHeight)
    meterFill.style.height = `${height}%`
  }
}

function handleOpponentDisconnect() {
  const warning = document.createElement('div')
  warning.className = 'disconnect-warning'
  warning.id = 'disconnect-warning'
  warning.textContent = 'Opponent disconnected. Waiting for reconnection...'
  document.body.appendChild(warning)
}

function handleOpponentReconnect() {
  const warning = document.getElementById('disconnect-warning')
  if (warning) warning.remove()
}

function getNetworkGameState(): NetworkGameState {
  const user = getCurrentUser()
  return {
    playerId: user?.id || '',
    timestamp: Date.now(),
    grid: state.grid,
    score: state.score,
    lines: state.lines,
    level: state.level,
    combo: state.combo,
    activePiece: state.active ? {
      key: state.active.key,
      rotation: state.active.rotation,
      position: state.active.position,
    } : undefined,
    isAlive: state.running === 'playing',
  }
}

function closeBattleScreen() {
  if (currentMatch) {
    cleanupBattle()
  }
  isBattleMode = false
  currentMatch = null

  const battleScreen = document.getElementById('battle-screen')
  if (battleScreen) battleScreen.classList.remove('active')

  hideModal('battle-result-modal')
  returnToMenu()
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
    const tile = 14
    const offsetX = 8
    const offsetY = 6 + i * 35
    shape.forEach((row, y) => {
      row.forEach((val, x) => {
        if (!val) return
        nextCtx.fillStyle = tetrominoes[key].color
        nextCtx.strokeStyle = toAlpha('#000', 0.4)
        nextCtx.lineWidth = 1.5
        nextCtx.beginPath()
        nextCtx.roundRect(offsetX + x * tile, offsetY + y * tile, tile - 2, tile - 2, 4)
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
    if (delta.x !== 0) soundManager.playMove()
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
    soundManager.playRotate()
    return
  }
  // naive wall kick left/right
  const kicks = [1, -1, 2, -2]
  for (const k of kicks) {
    if (!collides(piece, { x: piece.position.x + k, y: piece.position.y }, nextRotation)) {
      piece.position.x += k
      piece.rotation = nextRotation
      soundManager.playRotate()
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
  soundManager.playLand()
  const shape = currentShape()

  // Check if piece is above board (game over)
  for (let y = 0; y < shape.length; y++) {
    for (let x = 0; x < shape[y].length; x++) {
      if (!shape[y][x]) continue
      const gy = state.active.position.y + y
      if (gy < 0) {
        gameOver()
        return
      }
    }
  }

  // Lock piece to grid
  shape.forEach((row, y) => {
    row.forEach((val, x) => {
      if (!val) return
      const gx = state.active!.position.x + x
      const gy = state.active!.position.y + y
      state.grid[gy][gx] = tetrominoes[state.active!.key].color
    })
  })

  // Battle mode: apply pending garbage before clearing lines
  if (isBattleMode && isInBattle()) {
    const garbageLines = applyPendingGarbage()
    for (let i = 0; i < garbageLines; i++) {
      pushGarbage()
    }
    updateGarbageMeter()
  }

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

  // Play line clear sound
  soundManager.playClear(filled.length)

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

    // Battle mode: send garbage to opponent
    if (isBattleMode && isInBattle()) {
      battleOnLinesCleared(cleared)
    }

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
    state.active = undefined
    return piece
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
  soundManager.playDrop()
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
  soundManager.stopBGM()
  soundManager.playGameOver()

  // Battle mode: notify opponent and end battle
  if (isBattleMode && isInBattle()) {
    void battleOnMyGameOver()
    return
  }

  const reviveScoreEl = document.querySelector<HTMLSpanElement>('#revive-score')!
  reviveScoreEl.innerText = abbreviateScore(state.score)

  // First death - offer revival
  if (!state.reviveUsed) {
    showModal('revive-modal')
  } else {
    // Second death - end game and register ranking
    handleGameOver()
  }
}

async function handleGameOver() {
  hideModal('revive-modal')

  const entry: RankingEntry = {
    name: currentUser?.displayName || 'Anonymous',
    score: state.score,
    mode: state.mode,
    date: Date.now(),
    country: getUserCountryFlag()
  }

  // Submit ranking
  if (isAuthenticated()) {
    await submitAuthenticatedRanking(entry)
  } else {
    // For guest, save to local rankings only
    addRanking(entry)
    // Refresh menu ranking for guest too
    await renderMenuRanking(currentRankingMode)
  }

  // Show result modal
  showResultModal()
}

function showResultModal() {
  // Update result modal content
  const finalScoreEl = document.getElementById('result-final-score')
  const modeEl = document.getElementById('result-mode')
  const linesEl = document.getElementById('result-lines')
  const levelEl = document.getElementById('result-level')
  const rankEl = document.getElementById('result-rank')

  if (finalScoreEl) finalScoreEl.textContent = abbreviateScore(state.score)
  if (modeEl) modeEl.textContent = getModeLabel(state.mode)
  if (linesEl) linesEl.textContent = state.lines.toString()
  if (levelEl) levelEl.textContent = state.level.toString()

  // Calculate rank position
  const rank = calculateRankPosition(state.score, state.mode)
  if (rankEl) rankEl.textContent = rank > 0 ? `#${rank}` : '-'

  showModal('result-modal')
}

function calculateRankPosition(score: number, mode: ModeKey): number {
  const allRankings = loadRankings()
  const modeRankings = allRankings.filter((r: RankingEntry) => r.mode === mode)
  const position = modeRankings.filter((r: RankingEntry) => r.score > score).length + 1
  return position
}

// ---------- Hearts ----------

const GUEST_HEART_MAX = 1  // Guest gets 1 free game

interface GuestHeartState {
  hearts: number
  usedFreeGame: boolean
}

function loadGuestHearts(): GuestHeartState {
  const saved = localStorage.getItem('tetoris-guest-hearts')
  if (saved) {
    try {
      return JSON.parse(saved) as GuestHeartState
    } catch (e) {
      return { hearts: GUEST_HEART_MAX, usedFreeGame: false }
    }
  }
  return { hearts: GUEST_HEART_MAX, usedFreeGame: false }
}

function saveGuestHearts(state: GuestHeartState) {
  localStorage.setItem('tetoris-guest-hearts', JSON.stringify(state))
}

function loadHearts(): HeartState {
  // For logged in users, use server-synced hearts with recharge
  const saved = localStorage.getItem('tetoris-hearts')
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as HeartState
      return parsed
    } catch (e) {
      return { hearts: HEART_MAX, rechargeQueue: [] }
    }
  }
  return { hearts: HEART_MAX, rechargeQueue: [] }
}

function saveHearts() {
  localStorage.setItem('tetoris-hearts', JSON.stringify(heartState))
}

function hasHeart() {
  if (heartState.unlimitedUntil && heartState.unlimitedUntil > Date.now()) return true

  // Guest user: check guest hearts
  if (!isAuthenticated()) {
    const guestState = loadGuestHearts()
    return guestState.hearts > 0
  }

  // Logged in user: check normal hearts
  return heartState.hearts > 0
}

function consumeHeart() {
  if (heartState.unlimitedUntil && heartState.unlimitedUntil > Date.now()) return

  // Guest user: consume guest heart (no recharge)
  if (!isAuthenticated()) {
    const guestState = loadGuestHearts()
    if (guestState.hearts > 0) {
      guestState.hearts -= 1
      guestState.usedFreeGame = true
      saveGuestHearts(guestState)
    }
    return
  }

  // Logged in user: consume heart with recharge
  if (heartState.hearts > 0) {
    heartState.hearts -= 1
    heartState.rechargeQueue.push(Date.now() + HEART_RECHARGE_MS)
    saveHearts()
  }
}

function tickHearts() {
  // Guest users don't have recharge
  if (!isAuthenticated()) {
    renderHearts()
    renderRecharge()
    return
  }

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
  const unlimited = heartState.unlimitedUntil && heartState.unlimitedUntil > Date.now()

  // Guest user: show guest hearts
  if (!isAuthenticated()) {
    const guestState = loadGuestHearts()
    const full = '❤'
    const empty = '♡'
    const text = `${full.repeat(guestState.hearts)}${empty.repeat(GUEST_HEART_MAX - guestState.hearts)} (Guest)`
    heartsEl.textContent = text
    menuHeartsEl.textContent = text
    return
  }

  // Logged in user: show normal hearts
  const hearts = unlimited ? HEART_MAX : heartState.hearts
  const full = '❤'
  const empty = '♡'
  const text = unlimited ? '∞ (Unlimited)' : `${full.repeat(hearts)}${empty.repeat(HEART_MAX - hearts)}`
  heartsEl.textContent = text
  menuHeartsEl.textContent = text
}

function renderRecharge() {
  // Guest user: no recharge
  if (!isAuthenticated()) {
    const guestState = loadGuestHearts()
    if (guestState.hearts <= 0) {
      rechargeEl.textContent = 'Login for more hearts'
      menuRechargeEl.textContent = 'Login for more hearts'
    } else {
      rechargeEl.textContent = '1 free game available'
      menuRechargeEl.textContent = '1 free game available'
    }
    return
  }

  const now = Date.now()
  const next = heartState.rechargeQueue[0]
  let text = ''
  if (heartState.unlimitedUntil && heartState.unlimitedUntil > now) {
    const remain = heartState.unlimitedUntil - now
    text = `Unlimited ${formatMs(remain)} left`
  } else if (!next) {
    text = 'No recharge pending'
  } else {
    const remain = next - now
    text = `Next heart in ${formatMs(remain)}`
  }
  rechargeEl.textContent = text
  menuRechargeEl.textContent = text
}

// Reload hearts when auth state changes
function reloadHeartsOnAuthChange() {
  if (isAuthenticated()) {
    // Logged in: reload from localStorage (server-synced hearts)
    heartState = loadHearts()
  }
  renderHearts()
  renderRecharge()
}

// ---------- Input ----------

function bindEventListeners() {
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

  bindPad('#pad-left')
  bindPad('#pad-right')

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
    if (state.running === 'playing') pauseGame()
    showModal('store-modal')
  })

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

  // Store modal product buttons (handles both modal and sidebar)
  document.querySelectorAll<HTMLButtonElement>('[data-pack]').forEach((btn) => {
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
      alert('Out of hearts!')
      return
    }
    consumeHeart()
    renderHearts()
    renderRecharge()

    // Clear the board
    state.grid = createGrid()

    // Spawn a new piece
    state.active = spawnPiece()

    state.reviveUsed = true
    state.running = 'playing'
    hideModal('revive-modal')
    boardOverlay.innerText = ''
  })

  document.querySelector<HTMLButtonElement>('#revive-restart-btn')?.addEventListener('click', () => {
    handleGameOver()
  })

  // Game result modal - back to menu
  document.querySelector<HTMLButtonElement>('#game-result-menu-btn')?.addEventListener('click', () => {
    hideModal('result-modal')
    returnToMenu()
  })

  // Auth modal - tab switching
  document.querySelectorAll<HTMLButtonElement>('.auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab
      if (targetTab) {
        document.querySelectorAll('.auth-tab').forEach((t) => t.classList.remove('active'))
        tab.classList.add('active')
        document.querySelectorAll('.auth-form').forEach((f) => f.classList.remove('active'))
        document.querySelector(`#auth-${targetTab}-form`)?.classList.add('active')
      }
    })
  })

  // Auth modal - Google login buttons
  document.querySelector('#google-login-btn')?.addEventListener('click', (e) => {
    e.preventDefault()
    void handleGoogleLogin()
  })
  document.querySelector('#google-signup-btn')?.addEventListener('click', (e) => {
    e.preventDefault()
    void handleGoogleLogin()
  })

  // Auth modal - Email login
  document.querySelector('#login-submit-btn')?.addEventListener('click', (e) => {
    e.preventDefault()
    void handleEmailLogin()
  })

  // Auth modal - Email signup
  document.querySelector('#signup-submit-btn')?.addEventListener('click', (e) => {
    e.preventDefault()
    void handleEmailSignup()
  })

  // Auth modal - Guest button
  document.querySelector('#auth-guest-btn')?.addEventListener('click', () => {
    hideModal('auth-modal')
    pendingRankingSubmission = null
  })

  // Auth modal - Enter key on password fields
  document.querySelector('#login-password')?.addEventListener('keypress', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      e.preventDefault()
      void handleEmailLogin()
    }
  })
  document.querySelector('#signup-password')?.addEventListener('keypress', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      e.preventDefault()
      void handleEmailSignup()
    }
  })

  themeBtn.addEventListener('click', cycleTheme)
  menuThemeBtn.addEventListener('click', cycleTheme)

  // Sound toggle buttons
  const bgmBtn = document.getElementById('bgm-btn')
  const sfxBtn = document.getElementById('sfx-btn')

  if (bgmBtn) {
    bgmBtn.addEventListener('click', () => {
      soundManager.init()
      const enabled = soundManager.toggleBGM()
      bgmBtn.textContent = enabled ? '🎵' : '🔇'
      bgmBtn.title = enabled ? 'BGM On' : 'BGM Off'
    })
  }

  if (sfxBtn) {
    sfxBtn.addEventListener('click', () => {
      soundManager.init()
      const enabled = soundManager.toggleSFX()
      sfxBtn.textContent = enabled ? '🔊' : '🔈'
      sfxBtn.title = enabled ? 'SFX On' : 'SFX Off'
    })
  }
}

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
  soundManager.stopBGM()
  updateScreenVisibility()
  renderMenuRanking('all')
  boardOverlay.innerText = ''
}

function pauseGame(message = '') {
  if (state.running !== 'playing') return
  state.running = 'paused'
  boardOverlay.innerText = message
}

function openPauseModal() {
  pauseGame('Paused')
  showModal('pause-modal')
}

function resumeGame() {
  if (state.running !== 'paused') return
  state.running = 'playing'
  hideModal('pause-modal')
  boardOverlay.innerText = ''
}

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
      if (purchaseModalMode && state.screen === 'menu') {
        start(purchaseModalMode)
      }
    })
    .catch(() => {
      alert('Payment failed. Please try again.')
      hideModal('store-modal')
      hideModal('purchase-modal')
      if (state.running === 'paused') resumeGame()
    })
}

function cycleTheme() {
  const keys = Object.keys(themes) as ThemeKey[]
  const current = loadTheme()
  const idx = keys.indexOf(current)
  const next = keys[(idx + 1) % keys.length]
  applyTheme(next)
  saveTheme(next)
}

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
  // Prevent scrolling during loading
  document.body.style.overflow = 'hidden'

  let progress = 0
  return new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      progress = Math.min(100, progress + Math.random() * 18)
      loadingBar.style.width = `${progress}%`
      loadingText.textContent = progress < 100 ? `Loading... ${progress.toFixed(0)}%` : 'Ready'
      if (progress >= 100) {
        clearInterval(timer)
        loadingLayer.classList.add('hidden')
        // Re-enable scrolling after loading
        document.body.style.overflow = ''
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
      return []
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
    return localFiltered.slice(0, limit)
  }
  return data.map((row) => ({
    name: row.name ?? 'Unknown',
    score: row.score ?? 0,
    mode: (row.mode as ModeKey) ?? 'classic',
    date: row.created_at ? Date.parse(row.created_at as string) : Date.now(),
    country: (row as any).country ?? '🌐'
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
    country: entry.country || '🌐',
    created_at: new Date(entry.date).toISOString()
  })
  if (error) return
}

async function submitAuthenticatedRanking(entry: RankingEntry) {
  const client = getSupabase()
  if (!client) return

  const user = getCurrentUser()
  if (!user) {
    await submitRanking(entry)
    return
  }

  const { error } = await client.from('rankings').insert({
    user_id: user.id,
    display_name: user.displayName,
    name: user.displayName || entry.name,
    score: entry.score,
    mode: entry.mode,
    country: entry.country || '🌐',
    created_at: new Date(entry.date).toISOString()
  })

  if (error) {
    console.error('Failed to submit ranking:', error)
    return
  }

  addRanking(entry)
  await renderMenuRanking('all')
}

function getModeLabel(mode: ModeKey): string {
  const labels: Record<ModeKey, string> = {
    classic: 'Classic',
    hard: 'Hard',
    gravity: 'Gravity',
    online: 'Online'
  }
  return labels[mode]
}

function getUserCountryFlag(): string {
  try {
    const lang = navigator.language || 'en-US'
    const countryCode = lang.split('-')[1] || lang.split('-')[0].toUpperCase()
    const codePoints = countryCode.split('').map(char => 127397 + char.charCodeAt(0))
    return String.fromCodePoint(...codePoints)
  } catch (e) {
    return '🌐'
  }
}

// expose for debug
;(window as any).tetoris = { state, start, hold, hardDrop, formatDateTime, loadRankings, addRanking }

// Initialize after DOM is fully loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeDOM)
} else {
  initializeDOM()
}
