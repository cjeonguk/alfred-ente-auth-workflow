# Ente Auth for Alfred

[ente CLI](https://github.com/ente-io/ente/tree/main/cli)로 Ente Auth의 2FA 코드를 Alfred에서 검색·복사·붙여넣기하는 workflow.

## 사용법

`ea {검색어}`로 Ente Auth 코드를 검색합니다.

- **↵** 코드 복사 (클립보드 기록에 남지 않음)
- **⌘↵** 맨 앞 앱에 바로 붙여넣기
- **⌥↵** 실시간 코드 보기 (1초마다 갱신, 여기서도 ↵ 복사 / ⌘↵ 붙여넣기)

만료 3초 전인 코드는 다음 코드가 나올 때까지 기다렸다가 복사합니다.

## 요구 사항

[ente CLI](https://github.com/ente-io/ente/tree/main/cli)를 설치하고 `ente account add`로 로그인해 두어야 합니다.

## 설정 (Workflow Configuration)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `keyword` | `ea` | 검색 키워드 |
| `ente_path` | `/opt/homebrew/bin/ente` | ente 실행 파일 경로 (Alfred는 셸 PATH를 읽지 않음) |
| `ente_account` | (비움) | 특정 계정을 쓰려면 `--account`에 넘길 이름 |

## 구조

```
src/                 Alfred workflow 폴더 그대로
├── info.plist       객체·연결·설정 정의
└── ente-auth.js     JXA 스크립트 (list / code / live)
scripts/
├── link.sh          src/를 Alfred workflows 폴더에 심링크 (개발용)
└── build.sh         dist/Ente-Auth.alfredworkflow 패키징
```

흐름:

```
ea {query} ──list──▶ ↵ / ⌘↵ ──code──▶ {var:action} ─┬─ paste → 붙여넣기
     │                  ▲                           ├─ error → 오류 알림
     └─ ⌥↵ ──live (1s rerun)                        └─ copy  → 복사 + 알림
```

- `list`: `ente auth code list --all`(온라인, 실패 시 `--offline`) 결과를 Alfred가 직접 필터링. 5분 캐시 + `loosereload`로 캐시를 보여주며 백그라운드 갱신.
- `code`: `ente auth code view <id> --offline`. 목록 갱신 때 이미 sync되므로 오프라인으로 빠르게 조회.
- `live`: OTP와 만료 시각을 Script Filter 변수로 유지해 만료 시에만 `ente`를 다시 호출.

## 개발

```sh
scripts/link.sh    # Alfred에 개발용으로 연결
scripts/build.sh   # 배포용 패키지 생성
```
