import { BattleChannel } from './battleChannel'
import type {
  Match,
  BattleState,
  NetworkGameState,
  GarbageAttack,
  MatchResult,
  RankChange,
} from './types'
import {
  GARBAGE_TABLE,
  COUNTDOWN_SECONDS,
  BATTLE_DROP_INTERVAL,
  BATTLE_SPEED_INCREASE_INTERVAL,
  BATTLE_SPEED_DECREASE_AMOUNT,
  BATTLE_MIN_DROP_INTERVAL,
} from './constants'
import {
  updateRankAfterMatch,
  getOrCreatePlayerRank,
} from './rankManager'
import {
  setPlayerReady,
  updateMatchStatus,
  updateMatchScore,
  saveMatchHistory,
} from './matchmaking'

// 배틀 게임 상태
let battleState: BattleState | null = null
let battleChannel: BattleChannel | null = null
let countdownInterval: ReturnType<typeof setInterval> | null = null
let matchStartTime: number = 0

// 외부에서 호출할 콜백들
let onBattleStart: (() => void) | null = null
let onBattleEnd: ((result: MatchResult) => void) | null = null
let onCountdownUpdate: ((count: number) => void) | null = null
let onOpponentStateUpdate: ((state: NetworkGameState) => void) | null = null
let onGarbageReceived: ((lines: number) => void) | null = null
let onOpponentDisconnect: (() => void) | null = null
let onOpponentReconnect: (() => void) | null = null

// 게임 상태 getter (main.ts에서 제공)
let getGameState: (() => NetworkGameState) | null = null
let getScore: (() => number) | null = null
let getLines: (() => number) | null = null

export interface BattleGameCallbacks {
  onBattleStart: () => void
  onBattleEnd: (result: MatchResult) => void
  onCountdownUpdate: (count: number) => void
  onOpponentStateUpdate: (state: NetworkGameState) => void
  onGarbageReceived: (lines: number) => void
  onOpponentDisconnect: () => void
  onOpponentReconnect: () => void
}

export interface GameStateProviders {
  getGameState: () => NetworkGameState
  getScore: () => number
  getLines: () => number
}

// 배틀 게임 초기화
export function initBattleGame(
  match: Match,
  myUserId: string,
  callbacks: BattleGameCallbacks,
  stateProviders: GameStateProviders
): void {
  const isPlayer1 = match.player1Id === myUserId
  const opponentId = isPlayer1 ? match.player2Id : match.player1Id
  const opponentName = isPlayer1 ? match.player2Name : match.player1Name

  battleState = {
    matchId: match.id,
    myUserId,
    opponentId,
    opponentName,
    myState: null,
    opponentState: null,
    incomingGarbage: 0,
    garbageSent: 0,
    isStarted: false,
    countdown: COUNTDOWN_SECONDS,
    result: 'pending',
  }

  // 콜백 저장
  onBattleStart = callbacks.onBattleStart
  onBattleEnd = callbacks.onBattleEnd
  onCountdownUpdate = callbacks.onCountdownUpdate
  onOpponentStateUpdate = callbacks.onOpponentStateUpdate
  onGarbageReceived = callbacks.onGarbageReceived
  onOpponentDisconnect = callbacks.onOpponentDisconnect
  onOpponentReconnect = callbacks.onOpponentReconnect

  // 상태 제공자 저장
  getGameState = stateProviders.getGameState
  getScore = stateProviders.getScore
  getLines = stateProviders.getLines

  // 배틀 채널 생성
  battleChannel = new BattleChannel(match.id, myUserId, {
    onOpponentState: handleOpponentState,
    onGarbageReceived: handleGarbageReceived,
    onOpponentGameOver: handleOpponentGameOver,
    onOpponentReady: handleOpponentReady,
    onCountdown: handleCountdown,
    onOpponentDisconnect: () => onOpponentDisconnect?.(),
    onOpponentReconnect: () => onOpponentReconnect?.(),
  })
}

// 배틀 연결 시작
export async function connectBattle(): Promise<boolean> {
  if (!battleChannel) return false
  return await battleChannel.connect()
}

// 준비 완료 전송
export async function sendReady(): Promise<void> {
  if (!battleChannel || !battleState) return

  battleChannel.sendReady()
  await setPlayerReady(battleState.matchId, battleState.myUserId)
}

// 상대방 준비 완료 처리
function handleOpponentReady(): void {
  // 양쪽 모두 준비되면 호스트(player1)가 카운트다운 시작
  if (battleState && battleState.myUserId < battleState.opponentId) {
    startCountdown()
  }
}

// 카운트다운 시작
function startCountdown(): void {
  if (!battleChannel || !battleState) return

  let count = COUNTDOWN_SECONDS

  countdownInterval = setInterval(() => {
    battleChannel?.sendCountdown(count)
    handleCountdown(count)

    count--
    if (count < 0) {
      if (countdownInterval) {
        clearInterval(countdownInterval)
        countdownInterval = null
      }
      startBattle()
    }
  }, 1000)
}

// 카운트다운 처리
function handleCountdown(count: number): void {
  if (!battleState) return
  battleState.countdown = count
  onCountdownUpdate?.(count)
}

// 배틀 시작
async function startBattle(): Promise<void> {
  if (!battleState || !battleChannel || !getGameState) return

  battleState.isStarted = true
  matchStartTime = Date.now()

  await updateMatchStatus(battleState.matchId, 'playing')

  // 게임 상태 동기화 시작
  battleChannel.startGameStateSync(getGameState)

  onBattleStart?.()
}

// 상대방 게임 상태 수신
function handleOpponentState(state: NetworkGameState): void {
  if (!battleState) return
  battleState.opponentState = state
  onOpponentStateUpdate?.(state)
}

// 방해블록 수신
function handleGarbageReceived(attack: GarbageAttack): void {
  if (!battleState) return
  battleState.incomingGarbage += attack.lines
  onGarbageReceived?.(attack.lines)
}

// 상대방 게임 오버 (승리)
async function handleOpponentGameOver(): Promise<void> {
  if (!battleState || battleState.result !== 'pending') return

  battleState.result = 'win'
  await endBattle(true)
}

// 라인 클리어 시 호출 (방해블록 계산)
export function onLinesCleared(linesCleared: number): void {
  if (!battleState || !battleChannel || !battleState.isStarted) return

  const garbageToSend = GARBAGE_TABLE[linesCleared] || 0

  if (garbageToSend <= 0) return

  // 받을 방해블록이 있으면 상쇄
  if (battleState.incomingGarbage > 0) {
    const cancelled = Math.min(battleState.incomingGarbage, garbageToSend)
    battleState.incomingGarbage -= cancelled
    const actualGarbage = garbageToSend - cancelled

    if (actualGarbage > 0) {
      battleChannel.sendGarbageAttack(actualGarbage)
      battleState.garbageSent += actualGarbage
    }
  } else {
    battleChannel.sendGarbageAttack(garbageToSend)
    battleState.garbageSent += garbageToSend
  }
}

// 받은 방해블록 적용 (피스 락 시 호출)
export function applyPendingGarbage(): number {
  if (!battleState) return 0

  const garbage = battleState.incomingGarbage
  battleState.incomingGarbage = 0
  return garbage
}

// 현재 받을 방해블록 수
export function getPendingGarbage(): number {
  return battleState?.incomingGarbage ?? 0
}

// 게임 오버 (패배)
export async function onMyGameOver(): Promise<void> {
  if (!battleState || !battleChannel || battleState.result !== 'pending') return

  battleState.result = 'loss'
  battleChannel.sendGameOver()
  await endBattle(false)
}

// 배틀 종료
async function endBattle(isWin: boolean): Promise<void> {
  if (!battleState) return

  battleChannel?.stopGameStateSync()

  const matchDuration = Math.floor((Date.now() - matchStartTime) / 1000)
  const myScore = getScore?.() ?? 0
  const myLines = getLines?.() ?? 0

  // 매치 상태 업데이트
  await updateMatchStatus(
    battleState.matchId,
    'finished',
    isWin ? battleState.myUserId : battleState.opponentId
  )

  // 점수 업데이트
  await updateMatchScore(battleState.matchId, battleState.myUserId, myScore, myLines)

  // 랭크 업데이트
  const rankBefore = await getOrCreatePlayerRank(battleState.myUserId)
  const rankChange = await updateRankAfterMatch(battleState.myUserId, isWin)
  const rankAfter = await getOrCreatePlayerRank(battleState.myUserId)

  // 매치 기록 저장
  if (rankBefore && rankAfter && rankChange) {
    await saveMatchHistory(
      battleState.matchId,
      battleState.myUserId,
      battleState.opponentId,
      battleState.opponentName,
      isWin ? 'win' : 'loss',
      myScore,
      battleState.opponentState?.score ?? 0,
      myLines,
      battleState.garbageSent,
      rankChange.pointsDelta,
      rankBefore.tier,
      rankBefore.division,
      rankAfter.tier,
      rankAfter.division,
      matchDuration
    )
  }

  // 결과 콜백
  const result: MatchResult = {
    matchId: battleState.matchId,
    isWin,
    myScore,
    opponentScore: battleState.opponentState?.score ?? 0,
    myLines,
    garbageSent: battleState.garbageSent,
    rankChange: rankChange ?? createDefaultRankChange(),
    matchDuration,
  }

  onBattleEnd?.(result)
}

// 기본 랭크 변경 (에러 시)
function createDefaultRankChange(): RankChange {
  return {
    before: { tier: 'Iron', division: 4, points: 0 },
    after: { tier: 'Iron', division: 4, points: 0 },
    pointsDelta: 0,
    promoted: false,
    demoted: false,
  }
}

// 배틀 정리
export function cleanupBattle(): void {
  if (countdownInterval) {
    clearInterval(countdownInterval)
    countdownInterval = null
  }

  battleChannel?.disconnect()
  battleChannel = null
  battleState = null

  onBattleStart = null
  onBattleEnd = null
  onCountdownUpdate = null
  onOpponentStateUpdate = null
  onGarbageReceived = null
  onOpponentDisconnect = null
  onOpponentReconnect = null
  getGameState = null
  getScore = null
  getLines = null
}

// 배틀 모드 설정 가져오기
export function getBattleSettings() {
  return {
    dropInterval: BATTLE_DROP_INTERVAL,
    speedIncreaseInterval: BATTLE_SPEED_INCREASE_INTERVAL,
    speedDecreaseAmount: BATTLE_SPEED_DECREASE_AMOUNT,
    minDropInterval: BATTLE_MIN_DROP_INTERVAL,
  }
}

// 현재 배틀 상태 가져오기
export function getBattleState(): BattleState | null {
  return battleState
}

// 배틀 중인지 확인
export function isInBattle(): boolean {
  return battleState !== null && battleState.isStarted
}

// 상대 정보 가져오기
export function getOpponentInfo(): { name: string; state: NetworkGameState | null } | null {
  if (!battleState) return null
  return {
    name: battleState.opponentName,
    state: battleState.opponentState,
  }
}
