import { getSupabase } from '../supabaseClient'
import type { PlayerRank, RankChange, TierKey } from './types'
import {
  TIER_ORDER,
  TIER_COLORS,
  TIER_NAMES_KR,
  POINTS_PER_DIVISION,
  WIN_POINTS,
  LOSS_POINTS,
  MAX_ONLINE_HEARTS,
  ONLINE_HEART_RECHARGE_MS,
  DEFAULT_TIER,
  DEFAULT_DIVISION,
  DEFAULT_POINTS,
} from './constants'

// 플레이어 랭크 가져오기 (없으면 생성)
export async function getOrCreatePlayerRank(userId: string): Promise<PlayerRank | null> {
  const client = getSupabase()
  if (!client) return null

  // 기존 랭크 조회
  const { data: existing, error: fetchError } = await client
    .from('player_ranks')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (existing) {
    return mapDbToPlayerRank(existing)
  }

  // 없으면 새로 생성
  if (fetchError?.code === 'PGRST116') {
    const { data: created, error: createError } = await client
      .from('player_ranks')
      .insert({
        user_id: userId,
        tier: DEFAULT_TIER,
        division: DEFAULT_DIVISION,
        points: DEFAULT_POINTS,
        total_points: 0,
        wins: 0,
        losses: 0,
        online_hearts: MAX_ONLINE_HEARTS,
        hearts_recharged_at: null,
      })
      .select()
      .single()

    if (createError) {
      console.error('Failed to create player rank:', createError)
      return null
    }

    return mapDbToPlayerRank(created)
  }

  console.error('Failed to fetch player rank:', fetchError)
  return null
}

// 랭크 업데이트 (승/패 후)
export async function updateRankAfterMatch(
  userId: string,
  isWin: boolean
): Promise<RankChange | null> {
  const client = getSupabase()
  if (!client) return null

  const currentRank = await getOrCreatePlayerRank(userId)
  if (!currentRank) return null

  const before = {
    tier: currentRank.tier,
    division: currentRank.division,
    points: currentRank.points,
  }

  const pointsDelta = isWin ? WIN_POINTS : -LOSS_POINTS
  const newRank = calculateNewRank(currentRank, pointsDelta)

  // DB 업데이트
  const { error } = await client
    .from('player_ranks')
    .update({
      tier: newRank.tier,
      division: newRank.division,
      points: newRank.points,
      total_points: currentRank.totalPoints + (isWin ? WIN_POINTS : 0),
      wins: currentRank.wins + (isWin ? 1 : 0),
      losses: currentRank.losses + (isWin ? 0 : 1),
    })
    .eq('user_id', userId)

  if (error) {
    console.error('Failed to update rank:', error)
    return null
  }

  const after = {
    tier: newRank.tier,
    division: newRank.division,
    points: newRank.points,
  }

  return {
    before,
    after,
    pointsDelta,
    promoted: getTierValue(after.tier, after.division) > getTierValue(before.tier, before.division),
    demoted: getTierValue(after.tier, after.division) < getTierValue(before.tier, before.division),
  }
}

// 새 랭크 계산
function calculateNewRank(
  current: PlayerRank,
  pointsDelta: number
): { tier: TierKey; division: number; points: number } {
  let points = current.points + pointsDelta
  let division = current.division
  let tierIndex = TIER_ORDER.indexOf(current.tier)

  // 승급 처리
  while (points >= POINTS_PER_DIVISION) {
    points -= POINTS_PER_DIVISION

    if (division > 1) {
      // 같은 티어 내에서 승급 (4 → 3 → 2 → 1)
      division--
    } else if (tierIndex < TIER_ORDER.length - 1) {
      // 다음 티어로 승급
      tierIndex++
      division = 4
    } else {
      // 최고 티어면 포인트만 유지
      points = POINTS_PER_DIVISION - 1
      break
    }
  }

  // 강등 처리
  while (points < 0) {
    if (division < 4) {
      // 같은 티어 내에서 강등
      division++
      points += POINTS_PER_DIVISION
    } else if (tierIndex > 0) {
      // 이전 티어로 강등
      tierIndex--
      division = 1
      points += POINTS_PER_DIVISION
    } else {
      // 최저 티어면 0으로 고정
      points = 0
      break
    }
  }

  return {
    tier: TIER_ORDER[tierIndex],
    division,
    points,
  }
}

// 티어 값 계산 (비교용)
function getTierValue(tier: TierKey, division: number): number {
  const tierIndex = TIER_ORDER.indexOf(tier)
  return tierIndex * 4 + (4 - division)
}

// 온라인 하트 사용
export async function useOnlineHeart(userId: string): Promise<boolean> {
  const client = getSupabase()
  if (!client) return false

  const rank = await getOrCreatePlayerRank(userId)
  if (!rank || rank.onlineHearts <= 0) return false

  // 하트 충전 확인
  const rechargedRank = await rechargeHeartsIfNeeded(userId, rank)
  if (rechargedRank.onlineHearts <= 0) return false

  // 하트 1개 사용
  const newHearts = rechargedRank.onlineHearts - 1
  const { error } = await client
    .from('player_ranks')
    .update({
      online_hearts: newHearts,
      hearts_recharged_at: newHearts < MAX_ONLINE_HEARTS ? new Date().toISOString() : null,
    })
    .eq('user_id', userId)

  return !error
}

// 하트 충전 확인 및 처리
async function rechargeHeartsIfNeeded(userId: string, rank: PlayerRank): Promise<PlayerRank> {
  if (rank.onlineHearts >= MAX_ONLINE_HEARTS) return rank
  if (!rank.heartsRechargedAt) return rank

  const lastRecharge = new Date(rank.heartsRechargedAt).getTime()
  const now = Date.now()
  const elapsed = now - lastRecharge
  const heartsToAdd = Math.floor(elapsed / ONLINE_HEART_RECHARGE_MS)

  if (heartsToAdd <= 0) return rank

  const newHearts = Math.min(MAX_ONLINE_HEARTS, rank.onlineHearts + heartsToAdd)
  const client = getSupabase()
  if (!client) return rank

  await client
    .from('player_ranks')
    .update({
      online_hearts: newHearts,
      hearts_recharged_at: newHearts < MAX_ONLINE_HEARTS ? new Date().toISOString() : null,
    })
    .eq('user_id', userId)

  return { ...rank, onlineHearts: newHearts }
}

// 온라인 하트 정보 가져오기
export async function getOnlineHearts(userId: string): Promise<{
  hearts: number
  nextRechargeIn: number | null
}> {
  const rank = await getOrCreatePlayerRank(userId)
  if (!rank) return { hearts: 0, nextRechargeIn: null }

  const rechargedRank = await rechargeHeartsIfNeeded(userId, rank)

  let nextRechargeIn: number | null = null
  if (rechargedRank.onlineHearts < MAX_ONLINE_HEARTS && rechargedRank.heartsRechargedAt) {
    const lastRecharge = new Date(rechargedRank.heartsRechargedAt).getTime()
    const nextRecharge = lastRecharge + ONLINE_HEART_RECHARGE_MS
    nextRechargeIn = Math.max(0, nextRecharge - Date.now())
  }

  return {
    hearts: rechargedRank.onlineHearts,
    nextRechargeIn,
  }
}

// 랭크 디스플레이 문자열
export function getRankDisplayString(tier: TierKey, division: number): string {
  if (tier === 'Challenger') return 'Challenger'
  return `${tier} ${division}`
}

// 랭크 디스플레이 (한글)
export function getRankDisplayStringKr(tier: TierKey, division: number): string {
  if (tier === 'Challenger') return '챌린저'
  return `${TIER_NAMES_KR[tier]} ${division}`
}

// 티어 색상 가져오기
export function getTierColor(tier: TierKey): string {
  return TIER_COLORS[tier]
}

// DB 데이터를 PlayerRank로 변환
function mapDbToPlayerRank(data: Record<string, unknown>): PlayerRank {
  return {
    userId: data.user_id as string,
    tier: data.tier as TierKey,
    division: data.division as number,
    points: data.points as number,
    totalPoints: data.total_points as number,
    wins: data.wins as number,
    losses: data.losses as number,
    onlineHearts: data.online_hearts as number,
    heartsRechargedAt: data.hearts_recharged_at as string | null,
  }
}

// 매칭 가능 티어 범위 계산
export function getMatchableTiers(tier: TierKey): TierKey[] {
  const tierIndex = TIER_ORDER.indexOf(tier)
  const tiers: TierKey[] = []

  for (let i = tierIndex - 1; i <= tierIndex + 1; i++) {
    if (i >= 0 && i < TIER_ORDER.length) {
      tiers.push(TIER_ORDER[i])
    }
  }

  return tiers
}
