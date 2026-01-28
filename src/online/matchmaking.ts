import { getSupabase } from '../supabaseClient'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { Match, MatchmakingCallbacks, PlayerRank, TierKey } from './types'
import { MATCHMAKING_TIMEOUT_MS } from './constants'
import { getMatchableTiers } from './rankManager'

let matchmakingChannel: RealtimeChannel | null = null
let queueChannel: RealtimeChannel | null = null
let matchmakingTimeout: ReturnType<typeof setTimeout> | null = null
let searchInterval: ReturnType<typeof setInterval> | null = null

interface UserInfo {
  id: string
  displayName: string
}

// 매칭 대기열 참가
export async function joinMatchmaking(
  user: UserInfo,
  rank: PlayerRank,
  callbacks: MatchmakingCallbacks
): Promise<boolean> {
  const client = getSupabase()
  if (!client) {
    callbacks.onError(new Error('Supabase client not available'))
    return false
  }

  // 기존 대기열 엔트리 삭제 (중복 방지)
  await client.from('matchmaking_queue').delete().eq('user_id', user.id)

  // 대기열에 추가
  const { error: insertError } = await client.from('matchmaking_queue').insert({
    user_id: user.id,
    display_name: user.displayName,
    tier: rank.tier,
    division: rank.division,
    total_points: rank.totalPoints,
    status: 'waiting',
  })

  if (insertError) {
    callbacks.onError(new Error('Failed to join matchmaking queue'))
    return false
  }

  // 개인 매칭 채널 구독
  matchmakingChannel = client.channel(`matchmaking:${user.id}`)
  matchmakingChannel
    .on('broadcast', { event: 'match_found' }, (payload) => {
      const match = payload.payload as Match
      cleanup()
      callbacks.onMatchFound(match)
    })
    .subscribe()

  // 대기열 변경 감시 (다른 플레이어 참가 시 매칭 시도)
  queueChannel = client.channel('matchmaking_queue_changes')
  queueChannel
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'matchmaking_queue',
      },
      () => {
        // 새 플레이어 참가 시 매칭 시도
        tryFindOpponent(user.id, rank, callbacks)
      }
    )
    .subscribe()

  // 즉시 상대 검색 시작
  tryFindOpponent(user.id, rank, callbacks)

  // 주기적으로 상대 검색 (5초마다)
  searchInterval = setInterval(() => {
    tryFindOpponent(user.id, rank, callbacks)
  }, 5000)

  // 타임아웃 설정
  matchmakingTimeout = setTimeout(() => {
    cleanup()
    leaveMatchmaking(user.id)
    callbacks.onTimeout()
  }, MATCHMAKING_TIMEOUT_MS)

  return true
}

// 상대 찾기 시도
async function tryFindOpponent(
  userId: string,
  rank: PlayerRank,
  callbacks: MatchmakingCallbacks
): Promise<void> {
  const client = getSupabase()
  if (!client) return

  const matchableTiers = getMatchableTiers(rank.tier)

  // 대기 중인 상대 검색
  const { data: candidates, error } = await client
    .from('matchmaking_queue')
    .select('*')
    .neq('user_id', userId)
    .eq('status', 'waiting')
    .in('tier', matchableTiers)
    .order('created_at', { ascending: true })
    .limit(1)

  if (error || !candidates || candidates.length === 0) return

  const opponent = candidates[0]

  // 양쪽 상태를 matched로 변경 (동시 매칭 방지)
  const { error: updateError } = await client
    .from('matchmaking_queue')
    .update({ status: 'matched' })
    .in('user_id', [userId, opponent.user_id])
    .eq('status', 'waiting')

  if (updateError) return

  // 매치 생성
  const myEntry = await client
    .from('matchmaking_queue')
    .select('display_name')
    .eq('user_id', userId)
    .single()

  const { data: match, error: matchError } = await client
    .from('matches')
    .insert({
      player1_id: userId,
      player2_id: opponent.user_id,
      player1_name: myEntry.data?.display_name || 'Player 1',
      player2_name: opponent.display_name,
      status: 'pending',
    })
    .select()
    .single()

  if (matchError || !match) {
    // 매치 생성 실패 시 상태 복구
    await client
      .from('matchmaking_queue')
      .update({ status: 'waiting' })
      .in('user_id', [userId, opponent.user_id])
    return
  }

  // 양쪽에 매치 알림
  const matchData: Match = {
    id: match.id,
    player1Id: match.player1_id,
    player2Id: match.player2_id,
    player1Name: match.player1_name,
    player2Name: match.player2_name,
    player1Ready: false,
    player2Ready: false,
    status: 'pending',
    player1Score: 0,
    player2Score: 0,
    createdAt: match.created_at,
  }

  // 상대방에게 알림
  await client.channel(`matchmaking:${opponent.user_id}`).send({
    type: 'broadcast',
    event: 'match_found',
    payload: matchData,
  })

  // 자신에게도 알림 (cleanup 후 콜백 호출)
  cleanup()
  callbacks.onMatchFound(matchData)
}

// 매칭 취소
export async function leaveMatchmaking(userId: string): Promise<void> {
  cleanup()

  const client = getSupabase()
  if (!client) return

  await client.from('matchmaking_queue').delete().eq('user_id', userId)
}

// 리소스 정리
function cleanup(): void {
  if (matchmakingTimeout) {
    clearTimeout(matchmakingTimeout)
    matchmakingTimeout = null
  }

  if (searchInterval) {
    clearInterval(searchInterval)
    searchInterval = null
  }

  if (matchmakingChannel) {
    matchmakingChannel.unsubscribe()
    matchmakingChannel = null
  }

  if (queueChannel) {
    queueChannel.unsubscribe()
    queueChannel = null
  }
}

// 매치 준비 완료 알림
export async function setPlayerReady(matchId: string, userId: string): Promise<boolean> {
  const client = getSupabase()
  if (!client) return false

  // 어떤 플레이어인지 확인
  const { data: match } = await client
    .from('matches')
    .select('player1_id, player2_id')
    .eq('id', matchId)
    .single()

  if (!match) return false

  const isPlayer1 = match.player1_id === userId
  const updateField = isPlayer1 ? 'player1_ready' : 'player2_ready'

  const { error } = await client
    .from('matches')
    .update({ [updateField]: true })
    .eq('id', matchId)

  return !error
}

// 매치 상태 업데이트
export async function updateMatchStatus(
  matchId: string,
  status: 'playing' | 'finished' | 'abandoned',
  winnerId?: string
): Promise<boolean> {
  const client = getSupabase()
  if (!client) return false

  const updateData: Record<string, unknown> = { status }

  if (status === 'playing') {
    updateData.started_at = new Date().toISOString()
  } else if (status === 'finished' || status === 'abandoned') {
    updateData.finished_at = new Date().toISOString()
    if (winnerId) updateData.winner_id = winnerId
  }

  const { error } = await client.from('matches').update(updateData).eq('id', matchId)

  return !error
}

// 매치 점수 업데이트
export async function updateMatchScore(
  matchId: string,
  userId: string,
  score: number,
  lines: number
): Promise<boolean> {
  const client = getSupabase()
  if (!client) return false

  const { data: match } = await client
    .from('matches')
    .select('player1_id')
    .eq('id', matchId)
    .single()

  if (!match) return false

  const isPlayer1 = match.player1_id === userId
  const scoreField = isPlayer1 ? 'player1_score' : 'player2_score'
  const linesField = isPlayer1 ? 'player1_lines' : 'player2_lines'

  const { error } = await client
    .from('matches')
    .update({
      [scoreField]: score,
      [linesField]: lines,
    })
    .eq('id', matchId)

  return !error
}

// 매치 기록 저장
export async function saveMatchHistory(
  matchId: string,
  userId: string,
  opponentId: string,
  opponentName: string,
  result: 'win' | 'loss' | 'abandoned',
  score: number,
  opponentScore: number,
  linesCleared: number,
  garbageSent: number,
  pointsChange: number,
  tierBefore: TierKey,
  divisionBefore: number,
  tierAfter: TierKey,
  divisionAfter: number,
  matchDurationSeconds: number
): Promise<boolean> {
  const client = getSupabase()
  if (!client) return false

  const { error } = await client.from('match_history').insert({
    match_id: matchId,
    player_id: userId,
    opponent_id: opponentId,
    opponent_name: opponentName,
    result,
    score,
    opponent_score: opponentScore,
    lines_cleared: linesCleared,
    garbage_sent: garbageSent,
    points_change: pointsChange,
    tier_before: tierBefore,
    division_before: divisionBefore,
    tier_after: tierAfter,
    division_after: divisionAfter,
    match_duration_seconds: matchDurationSeconds,
  })

  return !error
}
