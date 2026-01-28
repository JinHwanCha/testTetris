import type { TierKey } from './types'

// 티어 순서 (낮은 순 → 높은 순)
export const TIER_ORDER: TierKey[] = [
  'Iron',
  'Bronze',
  'Silver',
  'Gold',
  'Platinum',
  'Emerald',
  'Diamond',
  'Master',
  'Grandmaster',
  'Challenger',
]

// 티어별 색상
export const TIER_COLORS: Record<TierKey, string> = {
  Iron: '#5c5c5c',
  Bronze: '#cd7f32',
  Silver: '#c0c0c0',
  Gold: '#ffd700',
  Platinum: '#00d4ff',
  Emerald: '#50c878',
  Diamond: '#b9f2ff',
  Master: '#9932cc',
  Grandmaster: '#ff4500',
  Challenger: '#ff69b4',
}

// 티어별 한글 이름
export const TIER_NAMES_KR: Record<TierKey, string> = {
  Iron: '아이언',
  Bronze: '브론즈',
  Silver: '실버',
  Gold: '골드',
  Platinum: '플래티넘',
  Emerald: '에메랄드',
  Diamond: '다이아몬드',
  Master: '마스터',
  Grandmaster: '그랜드마스터',
  Challenger: '챌린저',
}

// 점수 시스템
export const POINTS_PER_DIVISION = 100
export const WIN_POINTS = 12
export const LOSS_POINTS = 4

// 온라인 하트 시스템
export const MAX_ONLINE_HEARTS = 5
export const ONLINE_HEART_RECHARGE_MS = 30 * 60 * 1000 // 30분

// 매칭 설정
export const MATCHMAKING_TIMEOUT_MS = 120000 // 2분
export const MATCHMAKING_TIER_RANGE = 1 // ±1 티어

// 게임 동기화
export const GAME_STATE_SYNC_INTERVAL_MS = 100 // 100ms = 10 FPS
export const DISCONNECT_TIMEOUT_MS = 15000 // 15초

// 카운트다운
export const COUNTDOWN_SECONDS = 3

// 방해블록 테이블 (클리어한 줄 수 → 보내는 방해블록 수)
export const GARBAGE_TABLE: Record<number, number> = {
  1: 0, // 싱글: 없음
  2: 1, // 더블: 1줄
  3: 2, // 트리플: 2줄
  4: 4, // 테트리스: 4줄
}

// Hard 모드 설정 (온라인 대전용)
export const BATTLE_DROP_INTERVAL = 760 // Hard 모드와 동일
export const BATTLE_SPEED_INCREASE_INTERVAL = 12000 // 12초마다 속도 증가
export const BATTLE_SPEED_DECREASE_AMOUNT = 40 // 속도 증가량
export const BATTLE_MIN_DROP_INTERVAL = 280 // 최소 낙하 간격

// 초기 랭크
export const DEFAULT_TIER: TierKey = 'Iron'
export const DEFAULT_DIVISION = 4
export const DEFAULT_POINTS = 0
