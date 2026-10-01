# 오늘의 진짜 정보판 (ALEPH T04)

서울 현재 기온(Open-Meteo 공개 API, 키 없음)을 Asia/Seoul 날짜당 한 줄씩 저장하고, 어제와 비교하고, 원천이 실패해도 마지막 정상값을 지우지 않는 정보판입니다. Cloudflare Workers + D1 무료 플랜으로 돌아갑니다.

## 구조

| 파일 | 역할 |
|---|---|
| `src/core.js` | 정규화·검증·실패 분류·전일 대비 계산 (live와 replay가 공유) |
| `src/store.js` | D1 저장. 같은 `(ns, signal_id, record_date)`는 `ON CONFLICT DO UPDATE`, 행·상태 갱신은 한 batch |
| `src/worker.js` | `/api/*` 라우트, live 어댑터, replay 어댑터 |
| `src/fixtures.js` | ALEPH 공개 fixture 9종 원문 (`npm run fixtures`로 `aleph-fixtures/`에서 재생성) |
| `public/index.html` | 공개 심사 화면 |
| `schema.sql` | D1 스키마 |
| `test/*.test.js` | fixture 재생 순서·live 실패 분류 테스트 (Node 22.5+, `npm test`) |

`ns`는 `live`(실제 기록)와 `replay`(합성 평가 상태) 두 가지입니다. 합성 초기화는 `replay`만 지웁니다.

비밀키를 쓰지 않으므로 브라우저 코드·배포 파일·네트워크 응답·Git 기록에 넣을 비밀값 자체가 없습니다.

## 배포

```bash
npm install
npx wrangler login                 # 배포하는 본인만 필요. 심사자는 로그인 없음
npx wrangler d1 create t04-board   # 출력된 database_id를 wrangler.toml에 붙여넣기
npm run db:init                    # 원격 D1에 schema.sql 적용
npm test                           # 12개 테스트 통과 확인
npm run deploy                     # https://t04-real-info-board.<본인 서브도메인>.workers.dev
```

배포 주소를 새 시크릿 창에서 열어 로그인 없이 보이는지 확인하세요.

소스는 **public** GitHub 저장소에 올리고, 소스 URL은 커밋 SHA가 들어간 형태로 제출합니다.
`https://github.com/<계정>/<저장소>/tree/<40자리 커밋 SHA>`

## 실제 날짜 2건 운영 절차 (C22~C24)

1일차 (KST):
1. 배포 후 '지금 조회'를 **한 번만** 누릅니다.
2. '원자료·저장값·화면값 대조'가 모두 일치인지 확인합니다.
3. 일별 기록 줄의 '복사'로 영수증 payload(`source_url`, `source_observed_at`, `normalized_value`, `unit`)를 받아 플랫폼에 `t04_day` 기록을 남깁니다.
4. 그날은 다시 누르지 않습니다. 같은 날 다시 조회하면 그 날짜 행의 값이 갱신되어 영수증과 달라집니다.

2일차 (다른 KST 날짜):
1. '지금 조회'를 한 번 누르고, 1일차와 같은 방식으로 확인한 뒤 영수증을 남깁니다.
2. 화면의 '어제 대비' 값이 두 영수증 값으로 직접 계산한 값과 같은지 확인합니다.
3. `wrangler.toml`의 `LIVE_LOCK = "true"`로 바꾸고 `npm run deploy` 합니다. 심사 중 누가 버튼을 눌러도 세 번째 날짜 행이 생기지 않습니다.

어제 대비 계산 규칙(화면에도 표시): 이 날짜 저장값 − 직전 날짜 저장값, 두 값 중 긴 소수 자릿수로 반올림, 단위가 다르면 계산하지 않음.

## 짧은 확인 방법

1. 어디로 가나요: 결과물 주소를 새 시크릿 창에서 엽니다.
2. 3단계 이내 무엇을 하나요: '합성 상태 초기화' → '실패 순서 재생'(실패 종류 선택) → '회복 직전까지 재생' 후 '다시 시도'.
3. 무엇이 보이면 통과인가요: 실패마다 다른 이유와 '오래된 값' 표시, 105와 행 1건 유지. 다시 시도 후 최신·행 2건·120·+15 pt, 대조표 모두 일치. 실제 조회 칸에 서로 다른 KST 날짜 2건과 어제 대비 변화.
4. 안 될 때 무엇이 보이나요: 대조표에 빨간 '불일치', 상태 표시줄에 실패 이유와 '다시 시도' 버튼.

## 알려진 한계

- 합성 재생 상태는 서버에 하나뿐이라 두 사람이 동시에 재생하면 결과표가 섞일 수 있습니다. 각 순서는 초기화부터 다시 시작합니다.
- Open-Meteo의 `current.time`은 15분 단위 모델 시각이며, 이 값을 출처 시각으로 표시합니다.
- 기상 데이터: Open-Meteo.com (CC BY 4.0).
