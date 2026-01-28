// Types
export type {
  TierKey,
  PlayerRank,
  Match,
  MatchmakingEntry,
  NetworkGameState,
  GarbageAttack,
  BattleState,
  RankChange,
  MatchResult,
  MatchmakingCallbacks,
  BattleChannelCallbacks,
} from './types'

// Constants
export {
  TIER_ORDER,
  TIER_COLORS,
  TIER_NAMES_KR,
  POINTS_PER_DIVISION,
  WIN_POINTS,
  LOSS_POINTS,
  MAX_ONLINE_HEARTS,
  ONLINE_HEART_RECHARGE_MS,
  MATCHMAKING_TIMEOUT_MS,
  GARBAGE_TABLE,
  COUNTDOWN_SECONDS,
  BATTLE_DROP_INTERVAL,
} from './constants'

// Rank Manager
export {
  getOrCreatePlayerRank,
  updateRankAfterMatch,
  useOnlineHeart,
  getOnlineHearts,
  getRankDisplayString,
  getRankDisplayStringKr,
  getTierColor,
  getMatchableTiers,
} from './rankManager'

// Matchmaking
export {
  joinMatchmaking,
  leaveMatchmaking,
  setPlayerReady,
  updateMatchStatus,
  updateMatchScore,
  saveMatchHistory,
} from './matchmaking'

// Battle Channel
export { BattleChannel } from './battleChannel'

// Battle Game
export {
  initBattleGame,
  connectBattle,
  sendReady,
  onLinesCleared,
  applyPendingGarbage,
  getPendingGarbage,
  onMyGameOver,
  cleanupBattle,
  getBattleSettings,
  getBattleState,
  isInBattle,
  getOpponentInfo,
} from './battleGame'
export type { BattleGameCallbacks, GameStateProviders } from './battleGame'
