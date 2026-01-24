# 테토리스 - Supabase 백엔드 설정 가이드

## 1. Supabase 프로젝트 생성

1. [supabase.com](https://supabase.com)에 접속하여 계정을 만듭니다
2. "New Project" 버튼을 클릭하여 새 프로젝트를 생성합니다
3. 프로젝트 이름, 데이터베이스 비밀번호, 지역을 설정합니다 (지역은 Asia Pacific (Seoul) 추천)

## 2. 데이터베이스 테이블 생성

1. Supabase 대시보드에서 좌측 메뉴의 **SQL Editor**를 클릭합니다
2. "New query" 버튼을 클릭합니다
3. 프로젝트 루트의 `supabase-schema.sql` 파일 내용을 복사하여 붙여넣습니다
4. "Run" 버튼을 클릭하여 SQL을 실행합니다

## 3. API 키 가져오기

1. Supabase 대시보드에서 좌측 메뉴의 **Project Settings** (⚙️ 아이콘)을 클릭합니다
2. **API** 섹션을 클릭합니다
3. 다음 정보를 확인합니다:
   - **Project URL**: `https://xxxxxxxxxxxxx.supabase.co` 형태의 URL
   - **anon public** key: `eyJhbG...` 형태의 긴 문자열

## 4. 환경 변수 설정

### 로컬 개발 환경

1. 프로젝트 루트에 `.env` 파일을 생성합니다 (`.env.example` 참고)
2. 다음과 같이 설정합니다:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

3. 위에서 복사한 Project URL과 anon key를 붙여넣습니다
4. 개발 서버를 재시작합니다: `npm run dev`

### 실환경 배포 (Vercel/Netlify 등)

#### Vercel
1. Vercel 대시보드에서 프로젝트 선택
2. **Settings** → **Environment Variables**로 이동
3. 다음 변수들을 추가:
   - Name: `VITE_SUPABASE_URL`, Value: `https://your-project-id.supabase.co`
   - Name: `VITE_SUPABASE_ANON_KEY`, Value: `your-anon-key`
4. 프로젝트를 다시 배포합니다

#### Netlify
1. Netlify 대시보드에서 사이트 선택
2. **Site settings** → **Environment variables**로 이동
3. **Add a variable** 클릭하여 추가:
   - Key: `VITE_SUPABASE_URL`, Value: `https://your-project-id.supabase.co`
   - Key: `VITE_SUPABASE_ANON_KEY`, Value: `your-anon-key`
4. 사이트를 다시 배포합니다

## 5. 테스트

1. 게임을 플레이하고 게임오버 후 이름을 입력합니다
2. 메인 메뉴의 "명예의 전당"에서 랭킹이 표시되는지 확인합니다
3. Supabase 대시보드의 **Table Editor**에서 `rankings` 테이블에 데이터가 저장되었는지 확인합니다

## 문제 해결

### 랭킹이 저장되지 않는 경우

1. **브라우저 콘솔 확인**: F12를 눌러 콘솔에서 에러 메시지를 확인합니다
2. **환경 변수 확인**: `.env` 파일이 올바르게 설정되었는지 확인합니다
3. **Supabase RLS 정책 확인**: SQL Editor에서 다음 쿼리로 정책이 설정되었는지 확인:
   ```sql
   SELECT * FROM pg_policies WHERE tablename = 'rankings';
   ```
4. **네트워크 탭 확인**: 브라우저 개발자 도구의 Network 탭에서 Supabase API 호출이 실패하는지 확인합니다

### 로컬에서는 되는데 배포 후 안 되는 경우

- 배포 플랫폼의 환경 변수가 올바르게 설정되었는지 확인
- 환경 변수 추가 후 반드시 재배포 필요
- 빌드 로그에서 환경 변수가 제대로 인식되었는지 확인

## 보안 참고사항

- `.env` 파일은 `.gitignore`에 포함되어 있어 Git에 커밋되지 않습니다
- `ANON_KEY`는 공개되어도 괜찮습니다 (Row Level Security로 보호됨)
- 절대로 `SERVICE_ROLE_KEY`는 클라이언트 코드에 사용하지 마세요
