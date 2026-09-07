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
| `ANTHROPIC_MODEL` | 선택 (AI 요약 쓸 때만) | 사용할 모델 이름. console.anthropic.com 문서에서 현재 사용 가능한 모델 이름을 확인해서 넣어주세요 — 여기서 특정 값을 미리 정해두면 나중에 모델이 바뀌었을 때 조용히 실패할 수 있어서 비워뒀습니다 |

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

- 이 코드는 **이 프로젝트를 만든 클라우드 작업공간에서는 실제 RSS 서버 접속이 네트워크 정책으로
  막혀 있어서, 실제 수집이 되는지 이 환경에서는 직접 검증하지 못했습니다.** 파싱·저장 로직은
  가상의 RSS 데이터로 별도 테스트해서 정상 동작을 확인했지만, `feeds.json`에 넣은 실제 URL 9개가
  전부 살아있는지는 GitHub Actions에서 처음 실행됐을 때(Actions 탭에서 `workflow_dispatch`로
  수동 실행 가능) 로그로 확인해주세요. 특정 소스가 계속 실패하면 URL이 바뀌었거나 접근이 막힌
  것이니 `feeds.json`에서 빼거나 교체하면 됩니다.
- Discord 전송 시각(21:00 KST)은 원하시는 시간을 알려주지 않으셔서 임의로 잡은 기본값입니다.
  다른 시간이 좋으면 위 "동작 주기 바꾸기"대로 바꿔주세요.
