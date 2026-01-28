import { getSupabase } from '../supabaseClient'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { NetworkGameState, GarbageAttack, BattleChannelCallbacks } from './types'
import { GAME_STATE_SYNC_INTERVAL_MS, DISCONNECT_TIMEOUT_MS } from './constants'

export class BattleChannel {
  private channel: RealtimeChannel | null = null
  private matchId: string
  private myUserId: string
  private syncInterval: ReturnType<typeof setInterval> | null = null
  private disconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private callbacks: BattleChannelCallbacks
  private getMyState: (() => NetworkGameState) | null = null

  constructor(matchId: string, userId: string, callbacks: BattleChannelCallbacks) {
    this.matchId = matchId
    this.myUserId = userId
    this.callbacks = callbacks
  }

  // 채널 연결
  async connect(): Promise<boolean> {
    const client = getSupabase()
    if (!client) return false

    this.channel = client.channel(`match:${this.matchId}`, {
      config: {
        presence: { key: this.myUserId },
      },
    })

    this.channel
      // 상대방 게임 상태 수신
      .on('broadcast', { event: 'game_state' }, (payload) => {
        const state = payload.payload as NetworkGameState
        if (state.playerId !== this.myUserId) {
          this.callbacks.onOpponentState(state)
        }
      })
      // 방해블록 수신
      .on('broadcast', { event: 'garbage_attack' }, (payload) => {
        const attack = payload.payload as GarbageAttack
        if (attack.fromPlayerId !== this.myUserId) {
          this.callbacks.onGarbageReceived(attack)
        }
      })
      // 상대방 게임 오버
      .on('broadcast', { event: 'game_over' }, (payload) => {
        const data = payload.payload as { playerId: string }
        if (data.playerId !== this.myUserId) {
          this.callbacks.onOpponentGameOver()
        }
      })
      // 상대방 준비 완료
      .on('broadcast', { event: 'player_ready' }, (payload) => {
        const data = payload.payload as { playerId: string }
        if (data.playerId !== this.myUserId) {
          this.callbacks.onOpponentReady()
        }
      })
      // 카운트다운 동기화
      .on('broadcast', { event: 'countdown' }, (payload) => {
        const data = payload.payload as { count: number }
        this.callbacks.onCountdown(data.count)
      })
      // 상대방 presence 변경
      .on('presence', { event: 'sync' }, () => {
        this.handlePresenceSync()
      })

    return new Promise<boolean>((resolve) => {
      this.channel!.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // 자신의 presence 등록
          this.channel!.track({
            user_id: this.myUserId,
            online_at: new Date().toISOString(),
          })
          resolve(true)
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          resolve(false)
        }
      })
    })
  }

  // Presence 동기화 처리
  private handlePresenceSync(): void {
    if (!this.channel) return

    const presenceState = this.channel.presenceState()
    const users = Object.values(presenceState).flat()
    const opponentPresent = users.some(
      (p) => (p as unknown as { user_id: string }).user_id !== this.myUserId
    )

    if (!opponentPresent) {
      // 상대방 연결 끊김
      this.startDisconnectTimer()
    } else {
      // 상대방 재연결
      this.clearDisconnectTimer()
      this.callbacks.onOpponentReconnect()
    }
  }

  // 연결 끊김 타이머 시작
  private startDisconnectTimer(): void {
    if (this.disconnectTimeout) return

    this.callbacks.onOpponentDisconnect()

    this.disconnectTimeout = setTimeout(() => {
      // 타임아웃 - 상대방 포기 처리
      this.callbacks.onOpponentGameOver()
    }, DISCONNECT_TIMEOUT_MS)
  }

  // 연결 끊김 타이머 해제
  private clearDisconnectTimer(): void {
    if (this.disconnectTimeout) {
      clearTimeout(this.disconnectTimeout)
      this.disconnectTimeout = null
    }
  }

  // 게임 상태 동기화 시작
  startGameStateSync(getState: () => NetworkGameState): void {
    this.getMyState = getState

    this.syncInterval = setInterval(() => {
      if (this.channel && this.getMyState) {
        this.channel.send({
          type: 'broadcast',
          event: 'game_state',
          payload: this.getMyState(),
        })
      }
    }, GAME_STATE_SYNC_INTERVAL_MS)
  }

  // 게임 상태 동기화 중지
  stopGameStateSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
    }
  }

  // 방해블록 전송
  sendGarbageAttack(lines: number): void {
    if (!this.channel || lines <= 0) return

    const attack: GarbageAttack = {
      fromPlayerId: this.myUserId,
      lines,
      timestamp: Date.now(),
    }

    this.channel.send({
      type: 'broadcast',
      event: 'garbage_attack',
      payload: attack,
    })
  }

  // 게임 오버 전송
  sendGameOver(): void {
    if (!this.channel) return

    this.channel.send({
      type: 'broadcast',
      event: 'game_over',
      payload: { playerId: this.myUserId, timestamp: Date.now() },
    })
  }

  // 준비 완료 전송
  sendReady(): void {
    if (!this.channel) return

    this.channel.send({
      type: 'broadcast',
      event: 'player_ready',
      payload: { playerId: this.myUserId },
    })
  }

  // 카운트다운 전송 (호스트만)
  sendCountdown(count: number): void {
    if (!this.channel) return

    this.channel.send({
      type: 'broadcast',
      event: 'countdown',
      payload: { count },
    })
  }

  // 채널 연결 해제
  disconnect(): void {
    this.stopGameStateSync()
    this.clearDisconnectTimer()

    if (this.channel) {
      this.channel.unsubscribe()
      this.channel = null
    }
  }
}
