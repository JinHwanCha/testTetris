-- =============================================
-- 온라인 대전 및 랭크 시스템용 Supabase 스키마
-- =============================================

-- 플레이어 랭크 테이블
CREATE TABLE IF NOT EXISTS public.player_ranks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL DEFAULT 'Iron' CHECK (tier IN ('Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Emerald', 'Diamond', 'Master', 'Grandmaster', 'Challenger')),
  division INTEGER NOT NULL DEFAULT 4 CHECK (division BETWEEN 1 AND 4),
  points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0 AND points < 100),
  total_points INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  online_hearts INTEGER NOT NULL DEFAULT 5 CHECK (online_hearts >= 0 AND online_hearts <= 5),
  hearts_recharged_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
  UNIQUE(user_id)
);

-- 매칭 대기열 테이블
CREATE TABLE IF NOT EXISTS public.matchmaking_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Emerald', 'Diamond', 'Master', 'Grandmaster', 'Challenger')),
  division INTEGER NOT NULL CHECK (division BETWEEN 1 AND 4),
  total_points INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'matched', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (timezone('utc', now()) + interval '2 minutes') NOT NULL,
  UNIQUE(user_id)
);

-- 매치 테이블
CREATE TABLE IF NOT EXISTS public.matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player1_id UUID NOT NULL REFERENCES auth.users(id),
  player2_id UUID NOT NULL REFERENCES auth.users(id),
  player1_name TEXT NOT NULL,
  player2_name TEXT NOT NULL,
  player1_ready BOOLEAN DEFAULT FALSE,
  player2_ready BOOLEAN DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'playing', 'finished', 'abandoned')),
  winner_id UUID REFERENCES auth.users(id),
  player1_score INTEGER DEFAULT 0,
  player2_score INTEGER DEFAULT 0,
  player1_lines INTEGER DEFAULT 0,
  player2_lines INTEGER DEFAULT 0,
  started_at TIMESTAMP WITH TIME ZONE,
  finished_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- 매치 히스토리 테이블 (상세 기록용)
CREATE TABLE IF NOT EXISTS public.match_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id),
  player_id UUID NOT NULL REFERENCES auth.users(id),
  opponent_id UUID NOT NULL REFERENCES auth.users(id),
  opponent_name TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('win', 'loss', 'abandoned')),
  score INTEGER NOT NULL,
  opponent_score INTEGER NOT NULL,
  lines_cleared INTEGER NOT NULL DEFAULT 0,
  garbage_sent INTEGER NOT NULL DEFAULT 0,
  points_change INTEGER NOT NULL,
  tier_before TEXT NOT NULL,
  division_before INTEGER NOT NULL,
  tier_after TEXT NOT NULL,
  division_after INTEGER NOT NULL,
  match_duration_seconds INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_player_ranks_user ON public.player_ranks(user_id);
CREATE INDEX IF NOT EXISTS idx_player_ranks_tier ON public.player_ranks(tier, division);
CREATE INDEX IF NOT EXISTS idx_player_ranks_total_points ON public.player_ranks(total_points DESC);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_status ON public.matchmaking_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_tier ON public.matchmaking_queue(tier, division);
CREATE INDEX IF NOT EXISTS idx_matches_status ON public.matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_players ON public.matches(player1_id, player2_id);
CREATE INDEX IF NOT EXISTS idx_match_history_player ON public.match_history(player_id, created_at DESC);

-- RLS 활성화
ALTER TABLE public.player_ranks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matchmaking_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_history ENABLE ROW LEVEL SECURITY;

-- player_ranks RLS 정책
CREATE POLICY "Anyone can read ranks" ON public.player_ranks
  FOR SELECT USING (true);

CREATE POLICY "Users can insert own rank" ON public.player_ranks
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own rank" ON public.player_ranks
  FOR UPDATE USING (auth.uid() = user_id);

-- matchmaking_queue RLS 정책
CREATE POLICY "Anyone can read queue" ON public.matchmaking_queue
  FOR SELECT USING (true);

CREATE POLICY "Users can join queue" ON public.matchmaking_queue
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own queue entry" ON public.matchmaking_queue
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can leave queue" ON public.matchmaking_queue
  FOR DELETE USING (auth.uid() = user_id);

-- matches RLS 정책
CREATE POLICY "Players can read own matches" ON public.matches
  FOR SELECT USING (auth.uid() = player1_id OR auth.uid() = player2_id);

CREATE POLICY "Authenticated users can create matches" ON public.matches
  FOR INSERT WITH CHECK (auth.uid() = player1_id OR auth.uid() = player2_id);

CREATE POLICY "Players can update own matches" ON public.matches
  FOR UPDATE USING (auth.uid() = player1_id OR auth.uid() = player2_id);

-- match_history RLS 정책
CREATE POLICY "Users can read own history" ON public.match_history
  FOR SELECT USING (auth.uid() = player_id);

CREATE POLICY "Authenticated users can insert history" ON public.match_history
  FOR INSERT WITH CHECK (auth.uid() = player_id);

-- Realtime 활성화
ALTER PUBLICATION supabase_realtime ADD TABLE public.matchmaking_queue;
ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;

-- 만료된 매칭 대기열 정리 함수
CREATE OR REPLACE FUNCTION clean_expired_matchmaking_queue()
RETURNS void AS $$
BEGIN
  DELETE FROM public.matchmaking_queue WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- updated_at 자동 업데이트 트리거
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_player_ranks_updated_at
  BEFORE UPDATE ON public.player_ranks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
