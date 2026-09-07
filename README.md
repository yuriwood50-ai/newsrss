# newsrss

RSS로 AI · IT · 경제 뉴스를 2시간마다 자동 수집하고, 화면에 분야별로 정리해서 보여주고,
하루 한 번 Discord로 요약해서 보내는 프로젝트입니다.

```
GitHub Actions(2시간마다) → RSS 수집·중복 제거 → data/news.json 커밋
                                                 → Vercel 자동 재배포 → 화면 갱신
GitHub Actions(하루 1회)  → data/news.json 읽어서 분야별 요약 → Discord Webhook 전송
```

## 프로젝트 구조

- `feeds.json` — 분야(카테고리)별 RSS 소스 목록. 소스를 추가/삭제하려면 이 파일만 고치면 됩니다.
- `data/news.json` — 수집된 기사가 쌓이는 곳. 최근 14일치, 최대 1500건까지만 보관하고 자동 정리됩니다.
- `scripts/collect.mjs` — RSS 수집 스크립트 (2시간마다 자동 실행).
- `scripts/daily-digest.mjs` — Discord 요약 전송 스크립트 (하루 1회 자동 실행).
- `app/page.tsx` — 화면 표시 페이지. `data/news.json`을 읽어 분야별로 최신순 렌더링.
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
