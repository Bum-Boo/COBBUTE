# COBBUTE 점검 보고서 (2026-10-31, 클라우드 세션)

- 기준: `main` @ `a73a0a4`
- 작업 브랜치: `claude/workflow-actions-health-check-eqv9b5`
- 범위:
  1. Dependabot GitHub Actions PR 5건(#1~#5)을 한 번에 적용하고 검증
  2. 저장소 전체 상태 점검: `HermesControlModern`, `telegram-workbot`, 루트 PowerShell 스크립트
- 데이터와 외부 호출: 모든 데이터는 합성 데이터입니다. Telegram, GitHub API, Ollama, ComfyUI, WSL, nvidia-smi는 실제로 호출하지 않고 모두 fake/mock으로 대체했습니다.
- 다운로드: 의존성과 빌드 도구(npm 패키지, Electron/AppImage/fpm 바이너리, actionlint, PowerShell 7)와 액션 `action.yml`/README만 내려받았습니다.

분류 기준:

| 분류 | 의미 |
| --- | --- |
| **검증된 결함** | 재현 후 수정하고 회귀 테스트를 추가함. 미수정이면 따로 표시 |
| **정적 위험** | 코드상 개연성은 있으나 이 VM에서 재현할 수 없음 |
| **이미 대응됨** | 기존 코드나 설정이 이미 처리함 |
| **문제 아님** | 확인 결과 정상 |

## 1. GitHub Actions 업데이트

### 1-1. 적용 내역

`.github/workflows/release.yml`에 다섯 가지 업데이트를 모두 적용했습니다(커밋 `79a19f8`).

| 액션 | 변경 |
| --- | --- |
| `actions/checkout` | v4 → v7 |
| `actions/setup-node` | v4 → v7 |
| `actions/upload-artifact` | v4 → v7 |
| `actions/download-artifact` | v4 → v8 |
| `actions/attest-build-provenance` | v3 → v4 |

### 1-2. 호환성 점검 결과

- **입력값: 문제 아님.**
  - actionlint 1.7.7은 새 메이저 버전의 입력 목록을 알지 못합니다. 오타(`merge-multipl`)를 넣어도 통과하는 것을 직접 확인했습니다.
  - 그래서 각 태그의 `action.yml`을 내려받아 워크플로의 `with:` 키와 대조하는 스크립트를 따로 돌렸습니다.
  - 결과: 19개 입력 중 문제 0건. 같은 오타를 넣으면 1건으로 잡히는 것도 확인했습니다.
  - 모든 액션의 런타임은 `node24`이며, attest만 composite입니다.
- **checkout v5~v7: 문제 아님.**
  - 바뀐 점: node24 런타임(러너 2.327.1 이상 필요), 자격증명을 `$RUNNER_TEMP`의 별도 파일에 저장, `pull_request_target`/`workflow_run`에서 fork PR checkout 차단.
  - 이 워크플로는 태그 push와 `workflow_dispatch`만 쓰고, `gh`는 `GH_TOKEN`으로 인증하므로 영향이 없습니다.
- **setup-node v5~v7: 문제 아님.**
  - `package.json`에 `packageManager` 필드가 없어 자동 캐시가 켜지지 않습니다.
  - 기존의 명시적 `cache: npm`, `cache-dependency-path` 설정이 그대로 유효합니다.
- **upload-artifact v7 / download-artifact v8: 문제 아님.**
  - 아티팩트 이름(`windows-release`, `linux-release`)이 서로 겹치지 않습니다(`release.yml:52`, `:73`).
  - `pattern: '*-release'`와 `merge-multiple: true`(`release.yml:89-90`) 조합은 v8에서도 같은 의미입니다.
  - 새 기본값 `digest-mismatch: error`는 무결성 검사를 강화할 뿐입니다.
  - 두 아티팩트 모두 `SHA256SUMS.txt`를 가지고 있어 병합할 때 한쪽이 덮어씌워집니다. 하지만 release job이 `create-checksums.mjs ../release`로 다시 생성하므로 **이미 대응됨**입니다.
  - 아래 1-3에서 실제 Linux 산출물로 이 흐름을 재현했습니다.
- **attest-build-provenance v4: 문제 아님.**
  - v4는 `actions/attest@v4.2.1`을 감싼 래퍼입니다.
  - 필요한 권한 `id-token: write`, `attestations: write`가 이미 선언되어 있습니다(`release.yml:11-12`).
  - `create-storage-record` 기본값은 true지만 `push-to-registry`가 true일 때만 동작하므로 추가 권한이 필요 없습니다.
  - `subject-path: 'release/*'`는 `uses:` 단계라서 `defaults.run.working-directory`의 영향을 받지 않고, 저장소 루트의 `release/`를 가리킵니다. download path와 일치합니다.

### 1-3. Release 파이프라인을 막던 결함

**검증된 결함 (수정, `76354a4`)**

- 증상: verify job의 `npm audit --audit-level=high`(`release.yml:29`)가 main에서 **exit 1**(high 8건)로 실패합니다. 즉 액션 버전과 무관하게 모든 릴리스가 막혀 있었습니다.
- 수정: 고정 버전을 같은 메이저 안에서 첫 패치 버전으로 올렸습니다(`HermesControlModern/package.json:33-39`).
  - `electron` 42.8.1 → 42.11.18
  - `vite` 8.0.16 → 8.1.6
  - `undici` override 7.29.0 → 7.30.1
  - 나머지 전이 의존성은 `npm audit fix`(force 없이)로 갱신했습니다.
- 남은 항목: moderate 15건. 모두 electron-builder 빌드 체인의 `minimatch` 계열이며, 고치려면 `--force`로 electron-builder를 다운그레이드해야 해서 손대지 않았습니다.
- 검증:
  - `npm run dist:linux`로 AppImage와 DEB를 생성했습니다.
  - Windows 산출물 2개는 가짜 파일로 대신하고, 아티팩트 병합 → 체크섬 재생성 → `sha256sum -c` 흐름을 재현했습니다. 4개 파일 모두 OK였습니다.
  - Xvfb와 Playwright로 패키지된 앱(Electron 42.11.18)을 띄워 렌더링을 확인했습니다.

**추가 변경**

- `npm test`를 verify job에 추가했습니다(`release.yml:30`, `e86780d`). CONTRIBUTING과 PR 템플릿에도 반영했습니다.
- `dependabot.yml`의 npm `directory`를 `/`에서 `/HermesControlModern`으로 바꿨습니다(`.github/dependabot.yml:4`, `9a13ef3`).
  - 루트에 `package.json`이 없어 npm 그룹 업데이트가 한 번도 제안되지 않았습니다. 실제로 열린 Dependabot PR은 github-actions뿐입니다.
  - 분류는 **정적 위험 → 수정**입니다. Dependabot 로그는 볼 수 없었습니다.

## 2. 제품 상태 점검

### 2-1. 클린 클론 기준 README 동작 여부

- **`HermesControlModern` README: 검증된 결함 (수정, `edbe51f`)**
  - 문서대로 `npm ci && npm start`를 실행하면 `dist/index.html`이 없어 창이 아예 뜨지 않습니다. Xvfb에서 60초 동안 창이 나오지 않는 것을 재현했습니다.
  - `npm run build` 후에는 정상 렌더링됩니다.
  - README의 순서를 `npm ci` → `npm run build` → `npm start`로 고쳤습니다(`README.md:49`).
- **`telegram-workbot` README: 문제 아님**
  - README 명령은 Windows PowerShell 기준입니다.
  - Linux에서 `python -m venv`, `pip install -r requirements.txt`, `pytest`를 돌리면 `.env`, 네트워크, PowerShell 없이 테스트가 통과합니다.

### 2-2. 수정한 결함

모든 수정은 재현 → 수정 → 회귀 테스트 순서로 진행했습니다.
- 수정 전 코드에서 새 테스트가 실패하는 것을 각각 확인했습니다.
  - Electron: 18개 중 12개 실패
  - workbot: 28개 중 24개 실패
  - PowerShell: 17개 중 12개 실패
  - 나머지는 이미 정상 동작하던 경우를 함께 묶어 둔 테스트입니다.
- 각 커밋 시점마다 테스트가 통과하는 것도 확인했습니다.

**HermesControlModern (Electron)**

새 테스트 하네스(`test/helpers/electron-harness.cjs`)는 `electron`, `child_process`, `http(s)`를 가짜로 바꿔 main 프로세스를 로드합니다. 실제 프로세스 실행이나 네트워크 호출은 없습니다.

1. **업데이트 확인이 베타 사용자에게 정식판을 알리지 못함** (`e4c2b5a`)
   - 원인: `main.cjs`는 prerelease 부분을 버리고, `main-linux.cjs`는 `beta`를 0으로 읽었습니다.
   - 결과: `/releases/latest`는 정식판만 반환하므로 `0.3.0-beta.1` 사용자는 `0.3.0`을 영원히 안내받지 못합니다. 두 플랫폼끼리도 비교 결과가 달랐습니다. 이전 함수를 직접 실행해 확인했습니다.
   - 수정: semver 비교를 `electron/version.cjs`로 통합하고 `main.cjs:16`, `main-linux.cjs:11`에서 사용합니다.
   - 테스트: `test/version.test.cjs`
2. **Windows 로그 스트리머의 셸/Python 인젝션** (`77c1fda`)
   - 원인: 프로필 이름과 Hermes Home이 bash와 Python 소스에 그대로 삽입되었습니다. Linux 쪽은 이름을 검증하고 있었습니다.
   - 수정:
     - 이름을 검증합니다(`log-streamer.cjs:43`).
     - bash에는 홑따옴표로 감싸 넘깁니다(`:80`).
     - Python에는 환경변수로 넘깁니다(`:50`).
   - 테스트: 실제 bash/python으로 디코드한 스크립트를 실행해 marker 파일이 생기지 않는지 확인합니다(`test/log-streamer.test.cjs`).
3. **설정값이 PowerShell, WSL, HTTP 검사로 그대로 흘러감** (`66d8081`)
   - 작업 스케줄러 이름이 큰따옴표 안에 삽입되어 PowerShell 인젝션이 가능했습니다. 홑따옴표 리터럴로 바꿨습니다(`main.cjs:789,799,844,1166`).
   - `hermes:logStart`가 이름을 검증하지 않았습니다. 검증을 추가했습니다(`main.cjs:1137`).
   - `checkHttp`가 항상 `http.get`을 써서 https 대시보드 URL이면 15초마다 status가 reject되었습니다. 프로토콜에 따라 선택하도록 고쳤습니다(`main.cjs:571`).
   - `wsl -l -v` 파싱에서 배포판 이름에 `(` 같은 정규식 문자가 있으면 예외가 났습니다. 이스케이프를 추가했습니다(`main.cjs:592`).
   - `updateSettings(null)`이 예외를 던졌습니다. 양쪽 플랫폼 모두 수정했습니다(`main.cjs:529`, `main-linux.cjs:202`).
   - 테스트: `test/main-windows.test.cjs`
4. **다른 프로필의 백업으로 복원될 수 있음** (`f1d4ee4`)
   - 원인: 백업 ID를 `-<이름>` 접미사로만 비교했습니다.
   - 결과: 프로필 `b`에서 `team-b`의 백업이 목록에 나오고 복원도 가능했습니다.
   - 수정: `<날짜>-<시간>-<이름>` 형식과 정확히 일치해야 합니다(`hermes-adapter.cjs:58,277,295`).
   - 테스트: 실제 bash/python으로 임시 디렉터리에서 확인합니다.
5. **Linux 로그 스트림 재시작 경쟁 조건** (`06df932`)
   - 원인: 이전 child의 비동기 `close`가 새 스트림의 상태를 지웠습니다.
   - 결과: 새 줄이 `null` 이름으로 전달되어 UI에서 무시되었고, `tail`이 누수되었습니다.
   - 수정: `log-streamer-linux.cjs:48-51`
6. **Linux에서 "모든 게이트웨이 중지" 후 크래시 감시가 꺼진 채 남음**, 그리고 **중지된 프로필에도 "재시작 필요" 표시** (`d586f6a`)
   - 수정: `main-linux.cjs:378,618,473`
7. **패키지된 Windows 앱에서 `powercfg-helper.ps1`이 `app.asar` 안에 있어 powershell.exe가 읽을 수 없음** (`4e2f73c`)
   - 확인 방법: Linux 빌드에서 `asar list`로 같은 구조임을 확인했습니다.
   - 수정: `electron-builder.yml:14`에 `asarUnpack`을 추가하고 `main.cjs:38`이 `app.asar.unpacked` 경로를 쓰게 했습니다.
   - 재빌드한 패키지에 `app.asar.unpacked/electron/powercfg-helper.ps1`이 있는 것을 확인했습니다.

**telegram-workbot**

8. **`/healthz`가 webhook 비밀 경로를 공개** (`ffe383e`)
   - 원인: 응답의 `webhook_path`에 `WEBHOOK_SECRET`이 들어 있었고, trycloudflare 공개 URL로 누구나 볼 수 있었습니다. 이 값만 알면 위조 업데이트를 보낼 수 있습니다.
   - 수정: `main.py:47`. 비밀 비교도 상수 시간 비교로 바꿨습니다(`:52`).
9. **응답 전송 실패 시 Telegram 재전송으로 기록 중복** (`ffe383e`)
   - 원인: 기록을 저장한 뒤 응답 전송이 실패하면 5xx가 반환되고, Telegram이 같은 업데이트를 다시 보내 같은 메모가 또 저장되었습니다.
   - 수정: 비밀이 일치하면 항상 200을 반환하고 오류는 로그로 남깁니다(`main.py:56-62`).
10. **설정 파싱 문제** (`ffe383e`)
    - 빈 `WEBHOOK_SECRET`이 조용히 랜덤값으로 대체되어, `set_webhook.py`가 등록한 URL과 영영 일치하지 않았습니다(`config.py:137`).
    - `.env` 줄 끝 주석이 값에 포함되었습니다. 예를 들어 `AUTO_REPORT_ENABLED=true # on`은 false로 읽혔습니다(`config.py:14`). 웹훅 스크립트들도 같은 파서를 쓰도록 맞췄습니다.
    - 정수 변환 오류 메시지에 변수 이름을 넣었습니다(`config.py:46`).
11. **메시지 형태에 따른 크래시** (`c59dbdc`)
    - `/메모` 바로 뒤에 줄바꿈, 탭, 전각 공백이 오면 알 수 없는 명령으로 처리되었습니다(`commands.py:30`).
    - 발신자나 채팅 ID가 없는 업데이트에서 `TypeError`가 났습니다(`bot.py:42`).
    - `/내근태 0-06`처럼 범위를 벗어난 연도에서 500 오류가 났습니다(`timeutils.py:31`).
    - 메시지 분할 길이를 UTF-16 기준으로 셉니다(`telegram_api.py:49-53`).
12. **LLM 호출이 이벤트 루프를 최대 180초 막음** (`9ed9785`)
    - 원인: 리소스 매니저 호출이 이벤트 루프 안에서 동기적으로 실행되었습니다.
    - 결과: 그동안 다른 webhook과 스케줄러가 멈췄습니다. 또 APScheduler의 기본 허용 지연이 1초라서, 18:30에 루프가 바쁘면 그날 자동 보고가 조용히 누락되었습니다.
    - 수정: `asyncio.to_thread`로 옮겼습니다(`bot.py:123-148`). 자동 보고 작업에 `misfire_grace_time=3600`과 `coalesce`를 설정했습니다(`scheduler.py:27`). 객체가 아닌 JSON 응답 처리도 추가했습니다(`llm.py:68,119`).

**루트 PowerShell 스크립트**

PowerShell 7.6.9를 설치해 실행했습니다. 테스트 파일은 `tests/local-ai/LocalAi.Tests.ps1`이며, 함수 정의만 로드하고 `Invoke-RestMethod`는 mock입니다.

13. **`embed`가 항상 빈 입력을 보냄** (`8f6d934`)
    - 원인: 매개변수 이름이 자동 변수 `$Input`이었습니다.
    - 수정: `local-ai-resource-manager.ps1:852,902`
14. **Windows PowerShell 5.1에서 한국어 메모가 들어간 상태 파일을 읽으면 턴 플래그가 초기화됨** (`8f6d934`)
    - 원인: 파일은 BOM 없는 UTF-8로 쓰는데 `Get-Content`가 기본 인코딩(ANSI/cp949)으로 읽었습니다.
    - 재현: cp949를 기본 인코딩으로 지정해 시뮬레이션했습니다.
    - 수정: 읽을 때 `-Encoding UTF8`을 지정합니다(`local-ai-resource-manager.ps1:99,389,798`, `local-ai-dispatcher.ps1:52`).
15. **dispatcher 의도 분류 오류** (`a04c6fb`)
    - "ComfyUI 이미지 생성 배치"가 vision으로 분류되었습니다.
    - 영어 키워드를 부분 문자열로 매칭했습니다. 예: storage → rag, statement → status, drawer → comfyui
    - 수정: `local-ai-dispatcher.ps1:186-205`

### 2-3. 수정하지 않은 항목

| 분류 | 위치 | 내용 / 제안 |
| --- | --- | --- |
| 검증된 결함 (미수정) | `telegram-workbot/workbot/llm.py:32-41`, `local-ai-resource-manager.ps1` param | `-ConfigPath:/tmp/evil.json`처럼 `-`로 시작하는 프롬프트가 매니저 매개변수로 바인딩됩니다(pwsh 7에서 재현). 공격자는 소유자(또는 이전에 위조 가능했던 업데이트)로 한정됩니다. 프롬프트를 stdin, 파일, base64 매개변수로 넘기도록 인터페이스를 바꿔야 해서 남겨 두었습니다. |
| 검증된 결함 (미수정) | `local-ai-dispatcher.ps1:215-271` | dispatcher가 `mixed` 턴과 `respect_turn_flags`를 무시해 매니저와 다른 모델을 고릅니다(보조 에이전트가 mock으로 재현). 매니저가 라우팅 결정을 JSON으로 내보내고 dispatcher는 그 값을 쓰도록 바꾸는 것을 권장합니다. |
| 정적 위험 | `HermesControl/HermesControl.ps1:42` | `ProcessStartInfo.ArgumentList`는 .NET Framework(PowerShell 5.1)에 없습니다. `.cmd` 런처는 `powershell.exe`(5.1)로 실행하므로 모든 외부 명령이 실패할 가능성이 큽니다. |
| 정적 위험 | `local-ai-resource-manager.ps1:219,237` | 5.1에서 `$ErrorActionPreference='Stop'`과 `2>&1`이 함께 쓰이면 native stderr가 종료 오류로 바뀔 수 있습니다(예: 로드되지 않은 모델에 `ollama stop`). |
| 정적 위험 | `local-ai-resource-manager.ps1:205-208` | nvidia-smi가 `[N/A]`를 출력하면 `[int]` 변환이 실패해 모든 라우팅 명령이 중단됩니다. `TryParse` 사용을 권장합니다. |
| 정적 위험 | `HermesControlModern/electron/main.cjs:449-472` | 패키지된 Windows 앱의 시작 프로그램 바로가기가 asar 안의 `.cmd`를 가리키며, 그 파일은 패키지에 없습니다. `app.setLoginItemSettings` 또는 `process.execPath` 기반으로 바꾸는 것을 권장합니다. |
| 정적 위험 | `HermesControlModern/src/App.jsx:252-298` | `{ok:false}` 결과에도 성공 토스트가 표시됩니다. |
| 정적 위험 | i18n | 한국어 UI에 "Stop all gateways" 등이 영어로 남아 있습니다(스크린샷으로 확인). zh/ja는 약 30개 키가 영어로 대체됩니다. |
| 정적 위험 | `telegram-workbot/scripts/set_webhook.py:40` | `secret_token`을 보내지 않고, 서버도 `X-Telegram-Bot-Api-Secret-Token` 헤더를 검사하지 않습니다. `.env.example`의 `change-me`를 그대로 쓰면 추측 가능합니다. |
| 정적 위험 | `telegram-workbot` | `TIMEZONE`을 바꾸면 기존 기록의 날짜 경계가 어긋납니다. `HOST`/`PORT`는 사용되지 않습니다. `on_event`는 deprecated입니다. |
| 정적 위험 | `HermesControlModern/scripts/create-checksums.mjs` | 플랫폼별 아티팩트의 `SHA256SUMS.txt`에 업로드하지 않는 `*-unpacked` 파일 75개가 함께 기록됩니다. 최종 릴리스 체크섬은 다시 생성되므로 결과에는 영향이 없습니다. |
| 이미 대응됨 | `preload.cjs`, `BrowserWindow` | `contextIsolation`, `sandbox`, `nodeIntegration:false`가 설정되어 있습니다. preload 채널과 핸들러가 1:1로 대응합니다. |
| 문제 아님 | 매니저 설정 키와 문서 | 문서의 명령과 설정 키가 코드와 일치합니다. 모든 `.ps1` 7개 파일이 파서 오류 0건입니다. |

## 3. 실행한 명령과 결과 (수정 전 → 후)

- 환경: Node 22.23.4, npm 10.9.9, Python 3.13.18, PowerShell 7.6.9, actionlint 1.7.7
- 경로: `HM` = `HermesControlModern`, `TW` = `telegram-workbot`

| 명령 | 수정 전 (`a73a0a4`) | 수정 후 |
| --- | --- | --- |
| `actionlint` | 0 errors | 0 errors |
| `action.yml` 입력 대조 스크립트 | — | 19개 입력, 문제 0 |
| `cd HM && npm ci` | 성공. 취약점 23건 (moderate 15, high 8) | 성공. moderate 15 |
| `npm audit --audit-level=high` | **exit 1** | exit 0 |
| `npm test` | 스크립트 없음 | 21 pass / 0 fail |
| `npm run build` | 통과 | 통과 |
| `npm run release:verify` | 통과 | 통과 |
| `npm run dist:linux` | (수정 후에만 실행) | AppImage, DEB 생성. Xvfb 스모크 테스트 통과 |
| `cd TW && python -m pytest -q` | 16 passed | 44 passed |
| `pwsh -NoProfile -File tests/local-ai/LocalAi.Tests.ps1` | 없음 (수정 전 코드로 실행 시 12 fail) | 17 pass |
| PowerShell 파서, `.ps1` 전체 7개 | 0 errors | 0 errors |

## 4. 이 VM에서 검증하지 못한 것

- **Windows와 Windows PowerShell 5.1**
  - 검증하지 못한 항목: `npm run dist:win`(NSIS, portable), 코드 서명, WSL 연동, 작업 스케줄러, UAC 승격 경로, WinForms 기반 `HermesControl.ps1`.
  - 2-2의 5.1 인코딩 문제는 pwsh 7에서 cp949를 기본값으로 지정해 시뮬레이션한 결과입니다.
- **macOS**: 지원 대상이 아니며 실행하지 않았습니다.
- **실제 GitHub Actions 러너**
  - 새 액션 버전이 실제로 동작하는지(아티팩트 업로드/다운로드, provenance 서명)는 실제 태그를 push해야 확인할 수 있습니다.
  - 이 세션은 태그를 만들거나 워크플로를 실행하지 않았습니다.
- **실제 외부 서비스와 장비**
  - Telegram Bot API, Cloudflare tunnel, Ollama, ComfyUI, nvidia-smi(실제 GPU), systemd user 서비스, 실제 Hermes/OpenClaw 설치
- **GUI**: Linux 패키지 앱이 Xvfb에서 렌더링되는 것만 확인했습니다. 버튼 동작 같은 실제 사용자 상호작용은 확인하지 않았습니다.
- **Dependabot npm 디렉터리 문제**: 로그를 볼 수 없어 정황 근거만 있습니다(npm PR이 한 번도 열리지 않음).

## 5. 소유자를 위한 다음 단계

1. 이 브랜치를 검토한 뒤 병합합니다.
   - Dependabot PR #1~#5는 이 브랜치에 모두 포함되어 있으므로, 병합 후 닫아도 됩니다.
   - 병합 후 npm Dependabot PR이 새로 열리기 시작합니다.
2. Windows 환경에서 다음을 확인합니다.
   - `npm ci`, `npm test`, `npm run dist:win`
   - 설치본에서 다음 기능이 동작하는지:
     - 진단 탭의 승격된 전원 요청 확인
     - 시작 프로그램 토글
     - 로그 스트림
   - 작업 스케줄러 이름에 공백이나 따옴표를 넣어도 시작/중지가 되는지 확인합니다.
3. 프리릴리스 태그(예: `v0.3.0-beta.2`, `package.json` 버전도 함께 변경)를 push해 새 액션 버전으로 릴리스 파이프라인 전체가 통과하는지 확인합니다.
4. Telegram 봇 운영 쪽:
   - `WEBHOOK_SECRET`을 추측하기 어려운 값으로 바꿉니다.
   - `set_webhook.py`에 `secret_token`을 추가하고 서버에서 헤더를 검사하도록 개선합니다.
   - 프롬프트 전달 방식을 stdin이나 파일로 바꿉니다(2-3 첫 번째 항목).
5. Windows PowerShell 5.1에서 확인합니다.
   - `HermesControl.ps1`의 `ArgumentList` 문제
   - native stderr 처리
   - 앞의 결과에 따라 `$psi.Arguments` 방식으로 바꾸거나 `pwsh` 사용을 검토합니다.
6. 남은 moderate 취약점(`minimatch`)은 electron-builder 상위 버전이 해결하면 Dependabot을 통해 갱신합니다.
