-- 오름 · 지자체 제도 검토 DB (Supabase / Postgres)
-- 지자체 담당자는 자기 지자체 제도만 보고 승인·반려할 수 있고, 계산기(로그인 없음)는 '승인' 제도만 읽는다.
-- 권한은 화면이 아니라 이 DB가 강제한다: 행 단위 보안(RLS) + 상태 변경 트리거.
-- 적용: Supabase 대시보드 → SQL Editor에 붙여 넣고 실행. 그다음 supabase/README.md의 순서대로 계정·제도를 넣는다.

-- 1. 담당자 권한 (본인이 바꿀 수 없음: 쓰기 정책 없음 → 관리자만 대시보드·서비스 키로 넣는다)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  role text not null check (role in ('admin', 'officer')),
  region text,          -- 시군구 담당자: "경상북도 경산시" 같은 rules.json 지역 키
  sido text,            -- 시·도 담당자: region 없이 sido만 (시·도 단위 제도 승인)
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "본인 권한 읽기" on public.profiles;
create policy "본인 권한 읽기" on public.profiles for select using (id = auth.uid());

-- 2. 지자체 제도 (조건 형식은 rules.json local_programs·AI 변환 결과와 같다)
create table if not exists public.local_programs (
  id text primary key,
  name text not null,
  region text,
  sido text,
  kind text not null check (kind in ('cash', 'inkind', 'access')),
  conditions jsonb not null default '[]',
  apply_checks jsonb not null default '[]',  -- 담당자가 '신청할 때 확인'으로 둔 조건 번호 (계산에서 제외, 안내만)
  facts jsonb,          -- 제도별 계산 보조값 (예: 북구 건강보험료 {"nhis_premium_rate": "bukgu_nhis_rate"})
  amount jsonb not null,
  amount_text text,
  note text,
  source text,
  origin jsonb,
  text text,
  status text not null default '검토 대기' check (status in ('검토 대기', '승인', '반려', '중지')),
  reason text,
  approved_by text,
  approved_at date,
  effective_from date,
  updated_at timestamptz not null default now(),
  check (region is not null or sido is not null)
);
alter table public.local_programs add column if not exists facts jsonb;  -- 예전에 만든 DB에도 추가
-- 매일 변경 확인에서 복지로 목록에서 3일 연속 사라진 날 (폐지 의심). 자동 중지하지 않고 담당자 화면에 표시만 한다
alter table public.local_programs add column if not exists source_gone_since date;
alter table public.local_programs enable row level security;

-- 지금 로그인한 사람의 권한
create or replace function public.my_profile() returns public.profiles
language sql stable security definer set search_path = public as $$
  select * from public.profiles where id = auth.uid()
$$;

-- 이 사람이 이 제도를 다룰 수 있나 (permissions.js canReview와 같은 규칙)
create or replace function public.can_review(p_region text, p_sido text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when me.role = 'admin' then true
      when me.role = 'officer' and p_region is not null then me.region = p_region
      when me.role = 'officer' and p_region is null then me.region is null and me.sido = p_sido
      else false end
    from public.profiles me where me.id = auth.uid()), false)
$$;

drop policy if exists "승인 제도는 누구나 읽기" on public.local_programs;
create policy "승인 제도는 누구나 읽기" on public.local_programs for select using (status = '승인');
drop policy if exists "담당 지역 제도 읽기" on public.local_programs;
create policy "담당 지역 제도 읽기" on public.local_programs for select using (public.can_review(region, sido));
drop policy if exists "담당 지역 제도 결정" on public.local_programs;
create policy "담당 지역 제도 결정" on public.local_programs for update
  using (public.can_review(region, sido)) with check (public.can_review(region, sido));
drop policy if exists "담당 지역 초안 등록" on public.local_programs;
create policy "담당 지역 초안 등록" on public.local_programs for insert
  with check (public.can_review(region, sido) and status = '검토 대기');

-- 3. 결정 이력 (누가 언제 무엇을)
create table if not exists public.program_events (
  id bigint generated always as identity primary key,
  program_id text not null references public.local_programs (id) on delete cascade,
  actor uuid,
  actor_name text,
  from_status text,
  to_status text not null,
  reason text,
  at timestamptz not null default now()
);
alter table public.program_events enable row level security;
drop policy if exists "담당 지역 이력 읽기" on public.program_events;
create policy "담당 지역 이력 읽기" on public.program_events for select using (
  exists (select 1 from public.local_programs p where p.id = program_id and public.can_review(p.region, p.sido)));

-- 4. 상태 변경 규칙 (permissions.js TRANSITIONS와 같다) + 지역·조건 바꿔치기 금지 + 이력 기록
create or replace function public.guard_program_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare me public.profiles := public.my_profile();
begin
  -- 로그인한 담당자(화면·API)에게만 적용한다. SQL Editor·서비스 키(auth.uid() 없음)는 시스템 관리 작업으로 본다
  if auth.uid() is null then
    new.updated_at := now();
    return new;
  end if;
  if new.region is distinct from old.region or new.sido is distinct from old.sido or new.conditions is distinct from old.conditions
     or new.facts is distinct from old.facts or new.source_gone_since is distinct from old.source_gone_since or new.name is distinct from old.name or new.kind is distinct from old.kind or new.text is distinct from old.text
     or new.source is distinct from old.source or new.origin is distinct from old.origin or new.effective_from is distinct from old.effective_from then
    raise exception '지역·조건·원문은 결정 화면에서 바꿀 수 없어요 (새 초안으로 올려 주세요)';
  end if;
  -- 금액·신청할 때 확인은 검토 대기 → 승인·반려 결정과 함께만 정한다 (승인된 제도의 금액을 몰래 바꾸지 못하게)
  if (new.apply_checks is distinct from old.apply_checks or new.amount is distinct from old.amount)
     and not (old.status = '검토 대기' and new.status is distinct from old.status) then
    raise exception '금액·신청할 때 확인 조건은 검토 대기 제도를 결정할 때만 정할 수 있어요';
  end if;
  -- 승인자·승인일은 화면이 보내는 값을 믿지 않는다 (승인할 때만 아래에서 DB가 채운다)
  new.approved_by := old.approved_by;
  new.approved_at := old.approved_at;
  if new.status is distinct from old.status then
    if not ((old.status = '검토 대기' and new.status in ('승인', '반려'))
         or (old.status = '반려' and new.status = '검토 대기')
         or (old.status = '승인' and new.status = '중지')
         or (old.status = '중지' and new.status = '검토 대기')) then
      raise exception '상태를 %에서 %(으)로 바꿀 수 없어요', old.status, new.status;
    end if;
    if new.status in ('반려', '중지') and coalesce(btrim(new.reason), '') = '' then
      raise exception '반려·중지에는 사유가 필요해요';
    end if;
    if new.status = '승인' then
      -- 계산할 수 있는 조건만 남아야 하고, 거주 지역 말고 조건이 하나 이상 있어야 한다 (permissions.js computable과 같은 규칙)
      if exists (
        select 1 from jsonb_array_elements(new.conditions) with ordinality as c(cond, n)
        where not (new.apply_checks @> to_jsonb(c.n - 1))
          and not (coalesce(c.cond->>'field', '') = any (array['age','household_size','income_recognized_pct_median','income_recognized_won',
            'total_income_annual','assets','recipient_status','basic_pension_recipient','residence_months','child_count','newborn',
            'school_enrolled','disabled','single_parent','senior_in_household','nhis_premium','third_child_7to18','child_birth_order','residence_region']))
      ) then
        raise exception '계산할 수 없는 조건이 남아 있어요 (신청할 때 확인으로 두거나 반려해 주세요)';
      end if;
      if not exists (
        select 1 from jsonb_array_elements(new.conditions) with ordinality as c(cond, n)
        where not (new.apply_checks @> to_jsonb(c.n - 1)) and c.cond->>'field' <> 'residence_region'
      ) then
        raise exception '계산하는 조건이 하나도 없어요 (거주 지역 말고 소득·나이 같은 조건이 필요해요)';
      end if;
      new.approved_by := coalesce(me.name, 'unknown');
      new.approved_at := current_date;
    end if;
    insert into public.program_events (program_id, actor, actor_name, from_status, to_status, reason)
    values (new.id, auth.uid(), me.name, old.status, new.status, new.reason);
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists guard_program_change on public.local_programs;
create trigger guard_program_change before update on public.local_programs
  for each row execute function public.guard_program_change();

-- 5. 표 접근 권한 (새 Supabase 프로젝트는 SQL로 만든 표에 자동으로 권한을 주지 않는다)
-- 어떤 행을 보고 바꿀 수 있는지는 위의 RLS·트리거가 다시 막는다. 여기서는 표 단위 출입만 연다.
grant usage on schema public to anon, authenticated, service_role;
grant select on public.local_programs to anon;                          -- 계산기: '승인' 제도만 (RLS)
grant select, insert, update on public.local_programs to authenticated; -- 담당자: 자기 지역만 (RLS·트리거)
grant select on public.profiles to authenticated;                       -- 본인 권한만 (RLS)
grant select on public.program_events to authenticated;                 -- 담당 지역 이력만 (RLS)
grant all on public.local_programs, public.profiles, public.program_events to service_role; -- seed·관리용
grant execute on function public.can_review(text, text), public.my_profile() to anon, authenticated;

-- 6. 중앙 기준값 (기준 중위소득·기준임대료 등 고시 값). 새 고시를 AI가 읽어 제안 → 시스템 관리자가 원문 대조 후 승인.
-- 계산기는 '승인'된 값 중 시행일(effective_from)이 오늘 이전인 가장 최근 값을 rules.json 위에 덮어 쓴다
-- → 2027년 값을 미리 승인해 두면 2027-01-01에 자동으로 바뀐다. 계산식은 바꿀 수 없고 값만.
create table if not exists public.central_values (
  id text primary key,                 -- <고시>_<행정규칙일련번호>_<값 키>
  key text not null,                   -- rules.json 경로 (예: lines.saeng_32, params.rent)
  value jsonb not null,                -- 지금 값과 같은 모양
  effective_from date not null,        -- 시행일
  notice jsonb not null,               -- 고시 이름·발령번호·발령일·일련번호·출처 번호
  evidence text,
  location text,
  proposed_by text,                    -- 예: ai:claude-opus-5-5
  status text not null default '검토 대기' check (status in ('검토 대기', '승인', '반려', '중지')),
  reason text,
  approved_by text,
  approved_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.central_values enable row level security;

-- 중앙 기준값은 전국에 영향을 주므로 시스템 관리자(admin)만 보고 결정한다
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
$$;

drop policy if exists "승인 기준값은 누구나 읽기" on public.central_values;
create policy "승인 기준값은 누구나 읽기" on public.central_values for select using (status = '승인');
drop policy if exists "관리자는 전체 읽기" on public.central_values;
create policy "관리자는 전체 읽기" on public.central_values for select using (public.is_admin());
drop policy if exists "관리자 결정" on public.central_values;
create policy "관리자 결정" on public.central_values for update using (public.is_admin()) with check (public.is_admin());
-- 등록(insert)은 매일 고시 확인(서비스 키)만 한다: 화면에서 넣는 정책 없음

create table if not exists public.central_events (
  id bigint generated always as identity primary key,
  value_id text not null references public.central_values (id) on delete cascade,
  actor uuid,
  actor_name text,
  from_status text,
  to_status text not null,
  reason text,
  at timestamptz not null default now()
);
alter table public.central_events enable row level security;
drop policy if exists "관리자 이력 읽기" on public.central_events;
create policy "관리자 이력 읽기" on public.central_events for select using (public.is_admin());

create or replace function public.guard_central_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare me public.profiles := public.my_profile();
begin
  if auth.uid() is null then  -- SQL Editor·서비스 키 = 시스템 관리 작업
    new.updated_at := now();
    return new;
  end if;
  if new.key is distinct from old.key or new.notice is distinct from old.notice
     or new.evidence is distinct from old.evidence or new.proposed_by is distinct from old.proposed_by then
    raise exception '고시·근거는 바꿀 수 없어요';
  end if;
  -- 시행일도 값처럼 검토 대기 상태에서 결정할 때만 고칠 수 있다 (부칙에서 값별 시행일이 다른 경우 등)
  if new.effective_from is distinct from old.effective_from and not (old.status = '검토 대기' and new.status is distinct from old.status) then
    raise exception '시행일은 검토 대기 기준값을 결정할 때만 고칠 수 있어요';
  end if;
  -- 값은 검토 대기 상태에서 결정할 때만 고칠 수 있다 (AI가 잘못 읽은 칸을 원문대로 바로잡기). 모양(최상위 형식)은 그대로
  if new.value is distinct from old.value then
    if not (old.status = '검토 대기' and new.status is distinct from old.status) then
      raise exception '값은 검토 대기 기준값을 결정할 때만 고칠 수 있어요';
    end if;
    if jsonb_typeof(new.value) <> jsonb_typeof(old.value) then
      raise exception '값의 형식이 달라요';
    end if;
  end if;
  new.approved_by := old.approved_by;
  new.approved_at := old.approved_at;
  if new.status is distinct from old.status then
    if not ((old.status = '검토 대기' and new.status in ('승인', '반려'))
         or (old.status = '반려' and new.status = '검토 대기')
         or (old.status = '승인' and new.status = '중지')
         or (old.status = '중지' and new.status = '검토 대기')) then
      raise exception '상태를 %에서 %(으)로 바꿀 수 없어요', old.status, new.status;
    end if;
    if new.status in ('반려', '중지') and coalesce(btrim(new.reason), '') = '' then
      raise exception '반려·중지에는 사유가 필요해요';
    end if;
    if new.status = '승인' then
      new.approved_by := coalesce(me.name, 'unknown');
      new.approved_at := current_date;
    end if;
    insert into public.central_events (value_id, actor, actor_name, from_status, to_status, reason)
    values (new.id, auth.uid(), me.name, old.status, new.status, new.reason);
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists guard_central_change on public.central_values;
create trigger guard_central_change before update on public.central_values
  for each row execute function public.guard_central_change();

grant select on public.central_values to anon;                   -- 계산기: '승인' 값만 (RLS)
grant select, update on public.central_values to authenticated;  -- 관리자만 (RLS·트리거)
grant select on public.central_events to authenticated;
grant all on public.central_values, public.central_events to service_role;
grant execute on function public.is_admin() to anon, authenticated;

-- 7. 담당자 계정 관리 (개발자 없이): 담당자가 관리자 화면에서 가입 신청 → 시스템 관리자가 승인하며 지역 지정
-- (Supabase Authentication → Sign In / Providers → Email의 "Confirm email"을 끄면 .test 같은 주소로도 바로 신청할 수 있다)
alter table public.profiles add column if not exists email text;

create table if not exists public.access_requests (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  name text not null,
  requested_region text,          -- 희망 담당 지역 (rules.json 지역 키)
  requested_sido text,
  note text,
  status text not null default '대기' check (status in ('대기', '승인', '반려')),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.access_requests enable row level security;
drop policy if exists "본인 가입 신청" on public.access_requests;
create policy "본인 가입 신청" on public.access_requests for insert with check (id = auth.uid() and status = '대기');
drop policy if exists "본인·관리자 신청 읽기" on public.access_requests;
create policy "본인·관리자 신청 읽기" on public.access_requests for select using (id = auth.uid() or public.is_admin());
drop policy if exists "관리자 신청 결정" on public.access_requests;
create policy "관리자 신청 결정" on public.access_requests for update using (public.is_admin()) with check (public.is_admin());

-- 권한(profiles)은 시스템 관리자만 주고·바꾸고·회수한다. 본인은 여전히 자기 것만 읽는다(1절)
drop policy if exists "관리자 전체 권한 읽기" on public.profiles;
create policy "관리자 전체 권한 읽기" on public.profiles for select using (public.is_admin());
drop policy if exists "관리자 권한 부여" on public.profiles;
create policy "관리자 권한 부여" on public.profiles for insert with check (public.is_admin());
drop policy if exists "관리자 권한 변경" on public.profiles;
create policy "관리자 권한 변경" on public.profiles for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "관리자 권한 회수" on public.profiles;
create policy "관리자 권한 회수" on public.profiles for delete using (public.is_admin());

-- 관리자가 자기 권한을 없애 아무도 관리할 수 없게 되는 일을 막는다
create or replace function public.guard_profile_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and old.id = auth.uid() and (tg_op = 'DELETE' or new.role <> 'admin') then
    raise exception '자기 관리자 권한은 없앨 수 없어요 (다른 관리자에게 부탁하세요)';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists guard_profile_change on public.profiles;
create trigger guard_profile_change before update or delete on public.profiles
  for each row execute function public.guard_profile_change();

grant select, insert, update, delete on public.profiles to authenticated;   -- 관리자만 (RLS·트리거)
grant select, insert, update on public.access_requests to authenticated;
grant all on public.access_requests to service_role;

-- 8. 감시 지역 (매일 지자체 제도 변경 확인할 시군구). 시스템 관리자가 관리자 화면 '운영 설정'에서 더하고 뺀다
-- 매일 확인(.github/workflows/policy-watch.yml)이 서비스 키로 읽는다. 새로 더한 지역은 다음 날부터 제도가 '검토 대기'로 들어온다
create table if not exists public.watch_regions (
  region text primary key,         -- rules.json 지역 키 (예: 경상북도 경산시)
  active boolean not null default true,
  added_by text,
  created_at timestamptz not null default now()
);
alter table public.watch_regions enable row level security;
drop policy if exists "관리자 감시 지역 읽기" on public.watch_regions;
create policy "관리자 감시 지역 읽기" on public.watch_regions for select using (public.is_admin());
drop policy if exists "관리자 감시 지역 추가" on public.watch_regions;
create policy "관리자 감시 지역 추가" on public.watch_regions for insert with check (public.is_admin());
drop policy if exists "관리자 감시 지역 변경" on public.watch_regions;
create policy "관리자 감시 지역 변경" on public.watch_regions for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "관리자 감시 지역 삭제" on public.watch_regions;
create policy "관리자 감시 지역 삭제" on public.watch_regions for delete using (public.is_admin());
insert into public.watch_regions (region, added_by) values
  ('경상북도 경산시', '처음 설정'), ('대구광역시 북구', '처음 설정'), ('경상북도 영천시', '처음 설정')
on conflict (region) do nothing;
grant select, insert, update, delete on public.watch_regions to authenticated;
grant all on public.watch_regions to service_role;
