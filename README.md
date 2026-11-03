# newsrss

RSS로 AI · IT · 경제 뉴스를 2시간마다 자동 수집하고, 화면에 분야별로 정리해서 보여주고,
하루 한 번 Discord로 요약해서 보내는 개인용 뉴스 대시보드입니다.

## 목적

여러 매체를 일일이 돌아다니지 않고 관심 분야 소식을 한곳에서 훑고, 하루 한 번 요약만 받아보기 위해 만들었습니다.
**서버·DB 없이** GitHub Actions + 저장소 안의 JSON 파일 + Vercel 렌더링만으로 운영해서 유지비가 들지 않습니다.

## 아키텍처

```
 RSS 매체들 ──▶ [Actions] collect.yml (2시간마다)
 (전자신문·AI타임스·        └ scripts/collect.mjs ──▶ data/news.json ──▶ git push
  한국경제·긱뉴스)                                          │
                                                           ▼
                                              Vercel 자동 재배포 ──▶ app/page.tsx (분야별 최신순)

 data/news.json ──▶ [Actions] daily-digest.yml (하루 1회, KST 21:00)
                      └ scripts/daily-digest.mjs ──▶ (선택) Anthropic API 요약 ──▶ Discord Webhook
```

핵심은 **`data/news.json` 이 DB 역할**을 한다는 점입니다. 수집 워크플로우가 이 파일을 갱신해 커밋하면, 그 커밋이 Vercel 재배포를 일으켜 화면이 최신 상태가 됩니다.

## 작동 방식

1. **수집** (`scripts/collect.mjs`, 2시간마다)
   - `feeds.json` 의 모든 소스를 순서대로 파싱합니다. 피드마다 15초 타임아웃이 있어 하나가 죽어도 나머지는 계속 수집합니다.
   - 기사 ID는 `guid`(없으면 `link`) 기준이라, 이미 저장된 기사나 여러 피드에 겹쳐 실린 기사는 건너뜁니다.
   - 최근 14일 · 최대 1500건만 남기고 정리한 뒤 `data/news.json` 에 최신순으로 저장합니다. 변경이 있을 때만 커밋합니다.
2. **표시** (`app/page.tsx`)
   - 서버 컴포넌트가 `data/news.json` 과 `feeds.json` 을 읽어 분야별 · 최신순으로 렌더링합니다. 시각은 KST 로 표시합니다.
3. **요약 전송** (`scripts/daily-digest.mjs`, 하루 1회)
   - 분야별 기사를 모아 Discord Webhook 으로 보냅니다. `ANTHROPIC_API_KEY` 가 있으면 AI 요약, 없으면 헤드라인 목록으로 대체합니다.

기술 스택: Next.js 16 (App Router) · React 19 · Tailwind 4 · rss-parser · GitHub Actions · Vercel

## 프로젝트 구조

- `feeds.json` — 분야(카테고리)별 RSS 소스 목록. 소스를 추가/삭제하려면 이 파일만 고치면 됩니다.
- `data/news.json` — 수집된 기사가 쌓이는 곳. 최근 14일치, 최대 1500건까지만 보관하고 자동 정리됩니다.
- `scripts/collect.mjs` — RSS 수집 스크립트 (2시간마다 자동 실행).
- `scripts/daily-digest.mjs` — Discord 요약 전송 스크립트 (하루 1회 자동 실행).
- `app/page.tsx` — 화면 표시 페이지. `data/news.json`을 읽어 분야별로 최신순 렌더링.
- `lib/` — 공용 코드 (`types.ts` 기사·피드 타입, `text.mjs` HTML 제거·기사 ID 생성, `format.ts` KST 시각 표시).
- `.github/workflows/collect.yml` — 2시간 주기 수집 워크플로우.
- `.github/workflows/daily-digest.yml` — 하루 1회 Discord 전송 워크플로우.

## 처음 설정할 때 (한 번만)

### 1. GitHub Secrets 등록

저장소 **Settings → Secrets and variables → Actions → Secrets** 탭에서 등록합니다.

| 이름 | 필수 여부 | 값 |
| --- | --- | --- |
| `DISCORD_WEBHOOK_URL` | 필수 | Discord 채널 연동 → 웹후크에서 복사한 주소 |
| `ANTHROPIC_API_KEY` | 선택 | console.anthropic.com에서 발급한 키. 없으면 AI 요약 없이 헤드라인 목록만 전송됩니다 |

AI 요약을 쓰려면 **Settings → Secrets and variables → Actions → Variables** 탭에도 아래를 등록하세요.

| 이름 | 필수 여부 | 값 |
| --- | --- | --- |
| `ANTHROPIC_MODEL` | 선택 (AI 요약 쓸 때만) | 사용할 모델 이름. `claude-opus-5`를 넣으면 됩니다. 나중에 모델 목록이 바뀔 수 있으니, 요약이 갑자기 안 되면 console.anthropic.com에서 현재 사용 가능한 모델 이름을 다시 확인해주세요 |

### 2. Vercel 연결

vercel.com → Add New → Project → 이 저장소(`newsrss`) Import → Framework는 Next.js 자동 감지 →
그대로 Deploy. 이후 저장소에 새 커밋(뉴스 자동 수집 포함)이 생길 때마다 자동으로 재배포됩니다.

### 3. GitHub Actions 권한 확인

저장소 **Settings → Actions → General → Workflow permissions**에서
**"Read and write permissions"**가 선택돼 있어야 `collect.yml`이 `data/news.json`을 커밋할 수 있습니다.

## 동작 주기 바꾸기

- 수집 주기: `.github/workflows/collect.yml`의 `cron: "0 */2 * * *"` 수정 (기본 2시간마다).
- Discord 전송 시각: `.github/workflows/daily-digest.yml`의 `cron: "0 12 * * *"` 수정.
  현재는 UTC 12:00 = 한국시간 21:00(밤 9시)으로 기본값을 넣어뒀습니다. 다른 시간을 원하면
  "원하는 KST 시각 − 9"를 UTC 시로 넣으면 됩니다.

## 로컬에서 확인하기

```bash
npm install
node scripts/collect.mjs      # 실제 RSS를 수집해 data/news.json에 반영
npm run dev                   # http://localhost:3000 에서 화면 확인
```

## 알려진 제약 · 확인이 필요한 부분

- **RSS 소스 상태 (2026-09-07 로컬 실행으로 확인)** — `feeds.json`의 소스 전부 정상 수집됐습니다
  (실패 0건). 이후 특정 소스가 계속 실패하면 URL이 바뀌었거나 접근이 막힌 것이니 `feeds.json`에서
  빼거나 교체하면 됩니다. 수집 로그는 Actions 탭에서 `Collect RSS` 워크플로우 실행 기록으로
  볼 수 있고, `workflow_dispatch`로 언제든 수동 실행할 수 있습니다.
- **한국경제 피드 3종(IT·경제·증권)은 제목만 옵니다.** 피드 원본에 `description` 요소가 없어서
  `summary`가 항상 빈 값입니다. 수집 자체는 정상이지만 Discord 요약에 넘어가는 재료가 제목뿐이라
  다른 소스보다 요약이 얕게 나올 수 있습니다. 본문 요약이 꼭 필요하면 소스 교체가 답입니다.
- **전자신문 3개 피드(AI·SW·IT/통신)는 기사가 상당 부분 겹칩니다.** guid 기준으로 중복 제거되므로
  실제 저장 건수는 소스별 수집 건수의 합보다 적게 나옵니다. 정상 동작입니다.
- Discord 전송 시각(21:00 KST)은 원하시는 시간을 알려주지 않으셔서 임의로 잡은 기본값입니다.
  다른 시간이 좋으면 위 "동작 주기 바꾸기"대로 바꿔주세요.
