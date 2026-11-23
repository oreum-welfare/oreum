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
  if new.region is distinct from old.region or new.sido is distinct from old.sido or new.conditions is distinct from old.conditions
     or new.name is distinct from old.name or new.kind is distinct from old.kind or new.text is distinct from old.text
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
