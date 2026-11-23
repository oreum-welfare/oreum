# 지자체 제도 검토: 로그인·권한 (Supabase)

관리자 화면의 **지자체 제도 검토**(`/admin/local`)는 두 가지 방식으로 동작합니다.

| 방식 | 언제 | 권한 검사 | 결정 저장 |
|---|---|---|---|
| 데모 모드 | 환경변수가 없을 때 (기본) | 화면에서만 (보안 아님) | 이 브라우저(localStorage) |
| Supabase 모드 | `VITE_SUPABASE_URL`·`VITE_SUPABASE_ANON_KEY`가 있을 때 | **DB가 강제** (행 단위 보안 + 트리거) | Supabase DB |

계산기(사용자 화면)는 어느 방식이든 **'승인' 제도만** 읽습니다. 가구 입력값은 어디로도 보내지 않습니다.

## 권한 규칙
- 지자체 담당자(`officer` + `region`): 자기 시군구 제도만 보고 승인·반려·중지
- 시·도 담당자(`officer` + `sido`, `region` 없음): 그 시·도 단위 제도만
- 시스템 관리자(`admin`): 전체
- 상태: `검토 대기 → 승인 / 반려`, `반려 → 검토 대기`, `승인 → 중지`, `중지 → 검토 대기`. 반려·중지는 사유 필수
- 결정 화면에서는 지역·조건을 바꿀 수 없음 (바꾸려면 새 초안으로)
- 모든 상태 변경은 `program_events`에 누가·언제·무엇을 남김
- 같은 규칙이 화면(`oreum-web/src/lib/permissions.js`)과 DB(`schema.sql`)에 함께 있습니다

## 연결 순서
1. [supabase.com](https://supabase.com)에서 프로젝트를 만듭니다.
2. **SQL Editor**에 `supabase/schema.sql`을 붙여 넣고 실행합니다.
3. **Authentication → Users**에서 담당자 계정을 만듭니다 (이메일·비밀번호는 각자 설정).
4. SQL Editor에서 계정마다 권한을 넣습니다. 사용자는 자기 권한을 바꿀 수 없습니다.
   ```sql
   insert into public.profiles (id, name, role, region, sido) values
     ('<경산시 담당자 user id>', '경산시 복지정책과', 'officer', '경상북도 경산시', '경상북도'),
     ('<관리자 user id>', '오름 시스템 관리자', 'admin', null, null);
   ```
5. 제도를 넣습니다 (서비스 키는 환경변수로만, 저장소에 올리지 않기).
   ```powershell
   $env:SUPABASE_URL="https://xxxx.supabase.co"; $env:SUPABASE_SERVICE_ROLE_KEY="(서비스 키)"; node supabase/seed_programs.mjs
   ```
6. Vercel → Project → Settings → Environment Variables에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`(공개용 anon 키)를 넣고 다시 배포합니다.
7. (선택) 매일 변경 확인(`.github/workflows/policy-watch.yml`)이 새 초안을 올리고 폐지 의심을 표시하게 하려면,
   GitHub 저장소 Secrets에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`를 넣습니다. 폐지 의심 표시는 `mark_gone.mjs`가 하고, 상태(승인·중지)는 바꾸지 않습니다.
