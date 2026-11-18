# Ente Auth for Alfred

[English](README.md) | 한국어

[ente CLI](https://ente.com/help/cli/)로 Ente Auth의 2FA 코드를 Alfred에서 검색·복사·붙여넣기하는 workflow.

## 설치

최신 릴리즈에서 [ente-auth.alfredworkflow](https://github.com/cjeonguk/alfred-ente-auth-workflow/releases/latest/download/ente-auth.alfredworkflow)를 받아 열면 Alfred로 가져올 수 있습니다.

## 사용법

`ea {검색어}`로 Ente Auth 코드를 검색합니다.

- **↵** 코드 복사 (클립보드 기록에 남지 않음)
- **⌘↵** 맨 앞 앱에 바로 붙여넣기
- **⌥↵** 실시간 코드 보기 (1초마다 갱신, 여기서도 ↵ 복사 / ⌘↵ 붙여넣기)

만료 3초 전인 코드는 다음 코드가 나올 때까지 기다렸다가 복사합니다.

각 코드에는 Ente Auth 앱과 같은 방식으로 고른 issuer 아이콘이 표시됩니다. Ente 자체 아이콘을 먼저 찾고, 없으면 [Simple Icons](https://simpleicons.org)를 찾고, 그래도 없으면 issuer 첫 글자를 넣은 색 원을 표시합니다. 아이콘은 처음 쓸 때 한 번 내려받아 캐시합니다. 앱에서 직접 고른 아이콘은 ente CLI로 알 수 없어서 반영되지 않습니다.

## 요구 사항

- [ente CLI](https://ente.com/help/cli/) **0.4.0 이상** (0.4.5에서 테스트)
- Ente Auth 로그인: `ente account login --app auth`

### ente CLI 호환성

ente CLI [0.4.0](https://github.com/ente-io/ente/releases/tag/ente-cli-v0.4.0) (2026-10-23)은 명령 체계가 바뀐 Rust 재작성 버전입니다. 이 workflow가 쓰는 명령과 옵션은 모두 0.4.0에서 처음 추가됐고, Auth 코드 명령과 JSON 출력은 0.4.5까지 바뀌지 않았습니다.

| workflow가 사용하는 기능 | 추가된 버전 |
|---|---|
| `ente auth code list --all` (JSON 필드 `id`, `name`, `issuer`, `accountName`, `type`) | 0.4.0 |
| `ente auth code view <id>` (JSON 필드 `otp`, `validUntil`) | 0.4.0 |
| 전역 옵션 `--json`, `--offline`, `--no-input`, `--account` | 0.4.0 |

이전 Go CLI(0.3.0 이하)는 **지원하지 않습니다.** Auth 관련 명령이 `ente auth decrypt`뿐이고 위 옵션도 없습니다. 이 버전으로 실행하면 코드 대신 CLI 오류 메시지가 표시됩니다.

## 설정 (Workflow Configuration)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `keyword` | `ea` | 검색 키워드 |
| `ente_path` | `/opt/homebrew/bin/ente` | ente 실행 파일 경로 (Alfred는 셸 PATH를 읽지 않음) |
| `ente_account` | (비움) | 특정 계정을 쓰려면 `--account`에 넘길 이름 |
| `icon_appearance` | Auto | 아이콘 밝은/어두운 버전. Auto는 시스템 외관을 따름. Alfred 테마에 맞추면 됨 |

## 구조

```
src/                 Alfred workflow 폴더 그대로
├── icon.png         Workflow 아이콘
├── info.plist       객체·연결·설정 정의
└── ente-auth.js     JXA 스크립트 (list / code / live)
scripts/
├── link.sh          src/를 Alfred workflows 폴더에 심링크 (개발용)
├── update-icon-sources.sh  issuer 아이콘 출처를 ente-io/ente 최신 main으로 고정
└── build.sh         dist/ente-auth.alfredworkflow 패키징
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
- issuer 아이콘: Ente Auth 앱의 `icon_utils.dart` 방식을 따름. 아이콘 목록과 SVG를 ente-io/ente와 그 simple-icons 서브모듈의 고정 커밋에서 받아, AppKit으로 PNG로 그리고 workflow 캐시 폴더에 저장.

## 개발

```sh
scripts/link.sh    # Alfred에 개발용으로 연결
scripts/build.sh   # 배포용 패키지 생성
```

### 릴리즈

버전 태그를 푸시하면 GitHub Actions(`.github/workflows/release.yml`)가 태그에서 workflow 버전을 설정하고, 패키지를 빌드해서 릴리즈 노트와 함께 GitHub Release를 만듭니다. `v1.1.0-beta.1`처럼 접미사가 붙은 태그는 프리릴리즈가 됩니다.

```sh
git tag v1.2.3
git push origin v1.2.3
```

저장소의 `src/info.plist` `version`은 `0.0.0-dev`로 유지합니다.

## 고지

이 workflow는 비공식이며 Ente와 제휴하거나 Ente의 승인을 받지 않았습니다.
Ente 및 Ente Auth는 각 소유자의 상표입니다.

Workflow 아이콘은 [ente-io/ente](https://github.com/ente-io/ente/blob/8980b6acefa8e5b36214ecfa9dc3795b31a59464/mobile/apps/auth/assets/generation-icons/icon-macos.png) 저장소의 공식 Ente Auth macOS 아이콘을 256×256으로 줄인 것입니다.

issuer 아이콘은 Ente Auth 자체 아이콘과 [Simple Icons](https://github.com/simple-icons/simple-icons)에서 실행 중에 내려받으며, 이 workflow에 포함되어 있지 않습니다. 모든 브랜드 이름과 로고는 각 소유자의 자산입니다.
