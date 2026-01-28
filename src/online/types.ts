// 티어 타입
export type TierKey =
  | 'Iron'
  | 'Bronze'
  | 'Silver'
  | 'Gold'
  | 'Platinum'
  | 'Emerald'
  | 'Diamond'
  | 'Master'
  | 'Grandmaster'
  | 'Challenger'

// 플레이어 랭크 정보
export interface PlayerRank {
  userId: string
  tier: TierKey
  division: number // 1-4 (1이 가장 높음)
  points: number // 0-99
  totalPoints: number
  wins: number
  losses: number
  onlineHearts: number
  heartsRechargedAt: string | null
}

// 매칭 대기열 엔트리
export interface MatchmakingEntry {
  id: string
  userId: string
  displayName: string
  tier: TierKey
  division: number
  totalPoints: number
  status: 'waiting' | 'matched' | 'cancelled'
  createdAt: string
}

// 매치 정보
export interface Match {
  id: string
  player1Id: string
  player2Id: string
  player1Name: string
  player2Name: string
  player1Ready: boolean
  player2Ready: boolean
  status: 'pending' | 'playing' | 'finished' | 'abandoned'
  winnerId?: string
  player1Score: number
  player2Score: number
  createdAt: string
  finishedAt?: string
}

// 네트워크로 전송되는 게임 상태
export interface NetworkGameState {
  playerId: string
  timestamp: number
  grid: (string | 0)[][]
  score: number
  lines: number
  level: number
  combo: number
  activePiece?: {
    key: string
    rotation: number
    position: { x: number; y: number }
  }
  isAlive: boolean
}

// 방해블록 공격 메시지
export interface GarbageAttack {
  fromPlayerId: string
  lines: number
  timestamp: number
}

// 배틀 게임 상태
export interface BattleState {
  matchId: string
  myUserId: string
  opponentId: string
  opponentName: string
  myState: NetworkGameState | null
  opponentState: NetworkGameState | null
  incomingGarbage: number
  garbageSent: number
  isStarted: boolean
  countdown: number
  result: 'win' | 'loss' | 'pending'
}

// 랭크 변동 결과
export interface RankChange {
  before: {
    tier: TierKey
    division: number
    points: number
  }
  after: {
    tier: TierKey
    division: number
    points: number
  }
  pointsDelta: number
  promoted: boolean
  demoted: boolean
}

// 매치 결과
export interface MatchResult {
  matchId: string
  isWin: boolean
  myScore: number
  opponentScore: number
  myLines: number
  garbageSent: number
  rankChange: RankChange
  matchDuration: number
}

// 매칭 콜백
export interface MatchmakingCallbacks {
  onMatchFound: (match: Match) => void
  onTimeout: () => void
  onError: (error: Error) => void
}

// 배틀 채널 콜백
export interface BattleChannelCallbacks {
  onOpponentState: (state: NetworkGameState) => void
  onGarbageReceived: (attack: GarbageAttack) => void
  onOpponentGameOver: () => void
  onOpponentReady: () => void
  onCountdown: (count: number) => void
  onOpponentDisconnect: () => void
  onOpponentReconnect: () => void
}
