-- Supabase 테이블 생성 SQL
-- Supabase 프로젝트 SQL Editor에서 실행하세요

-- rankings 테이블 생성
CREATE TABLE IF NOT EXISTS public.rankings (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('classic', 'hard', 'online', 'gravity')),
  country TEXT DEFAULT '🌐',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 인덱스 생성 (성능 향상)
CREATE INDEX IF NOT EXISTS idx_rankings_mode ON public.rankings(mode);
CREATE INDEX IF NOT EXISTS idx_rankings_score ON public.rankings(score DESC);
CREATE INDEX IF NOT EXISTS idx_rankings_created_at ON public.rankings(created_at DESC);

-- RLS (Row Level Security) 활성화
ALTER TABLE public.rankings ENABLE ROW LEVEL SECURITY;

-- 모든 사용자가 읽을 수 있도록 허용
CREATE POLICY "Enable read access for all users" ON public.rankings
  FOR SELECT
  USING (true);

-- 모든 사용자가 삽입할 수 있도록 허용
CREATE POLICY "Enable insert access for all users" ON public.rankings
  FOR INSERT
  WITH CHECK (true);

-- 선택사항: 오래된 데이터 자동 삭제 (각 모드별 상위 1000개만 유지)
-- 이 함수는 매일 실행하도록 Supabase의 Database Webhooks나 Edge Functions로 설정할 수 있습니다
CREATE OR REPLACE FUNCTION clean_old_rankings()
RETURNS void AS $$
BEGIN
  -- 각 모드별로 상위 1000개를 제외한 나머지 삭제
  DELETE FROM public.rankings
  WHERE id IN (
    SELECT id FROM (
      SELECT id,
             ROW_NUMBER() OVER (PARTITION BY mode ORDER BY score DESC, created_at ASC) as rn
      FROM public.rankings
    ) sub
    WHERE rn > 1000
  );
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- MIGRATION: Add Authentication Support
-- Run this after initial table creation
-- ========================================

-- Add user authentication columns to rankings table
ALTER TABLE public.rankings
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.rankings
ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Make name column nullable (authenticated users will use display_name)
ALTER TABLE public.rankings
ALTER COLUMN name DROP NOT NULL;

-- Add index for user_id lookups
CREATE INDEX IF NOT EXISTS idx_rankings_user_id ON public.rankings(user_id);

-- Update RLS policies for authenticated users
DROP POLICY IF EXISTS "Enable insert access for all users" ON public.rankings;

-- New insert policy: authenticated users must use their own user_id, guests can use NULL
CREATE POLICY "Enable insert for authenticated users" ON public.rankings
  FOR INSERT
  WITH CHECK (
    -- Either authenticated with matching user_id, or anonymous (user_id is null)
    (auth.uid() = user_id) OR (user_id IS NULL)
  );

-- Allow users to update their own rankings
CREATE POLICY "Users can update own rankings" ON public.rankings
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Allow users to delete their own rankings
CREATE POLICY "Users can delete own rankings" ON public.rankings
  FOR DELETE
  USING (auth.uid() = user_id);
