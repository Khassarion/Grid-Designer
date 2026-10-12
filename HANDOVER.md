# Grid Designer — 에이전트 인수인계

다음 담당 AI·개발자가 빠르게 맥락을 잡도록 정리한 문서입니다. 사용자 대면 문서는 [README.md](README.md), 기능 안내는 [tutorial.html](tutorial.html)을 우선 참고하세요.

---

## 1. 프로젝트 한 줄 요약

**정적 웹 에디터**: 후원·도네 이미지 등을 **격자 레이아웃**에 배치하고 **PNG**로 내보내 OBS 등에 씁니다. 백엔드·빌드·npm 없음. `index.html` + `js/*.js` + `styles.css`.

| 항목 | 값 |
|------|-----|
| 제품명 | Grid Designer |
| 앱 버전 | `js/version.js` → `GC_APP_VERSION` (현재 README 기준 **1.1.2.4**) |
| GitHub Pages | https://khassarion.github.io/Grid-Designer |
| 라이선스 | **비오픈소스** (Source-Available, 개인·비상업). [LICENSE](LICENSE) |

---

## 2. 저장소 구조

```
index.html          UI 골격, 모달, 사이드바·미리보기
styles.css          전역·폼·계층·미리보기·모달 스타일
js/app.js           편집기 본체 (~4k+ lines, IIFE)
js/grid.js          격자 배치 순수 함수 (ObsGrid)
js/i18n.js          ko/en 문자열, applyDom, t()
js/version.js       릴리즈 버전 + GC_CHANGELOG (업데이트 안내)
tutorial.html/css   짧은 사용 튜토리얼
screenshots/        README·changelog용 GIF
icons/              favicon, eye/eye-off SVG
.nojekyll           GitHub Pages
```

**테스트**: 자동화 테스트 없음. Chrome/Edge에서 수동 확인이 사실상의 QA.

---

## 3. 실행·배포

- 로컬: `index.html` 직접 열기 또는 정적 서버 (`npx serve .`)
- **File System Access API** (폴더 감시, PNG 경로 고정)는 **Chrome / Edge** 권장. Firefox 등은 제한적.
- 배포: 저장소 루트를 GitHub Pages로 서빙.

---

## 4. 아키텍처 (데이터 모델)

### 4.1 런타임 상태 (`js/app.js`)

| 변수 | 의미 |
|------|------|
| `layouts` | `{ [layoutId]: Layout }` — 캔버스도 레이아웃 하나 (`canvasId`) |
| `images` | `{ [imageId]: { name, url, img?, dataUrl? } }` |
| `activeId` | 현재 선택된 레이아웃(또는 캔버스) |
| `selectedChild` | 계층에서 선택한 자식 인덱스 |
| `previewSel` | 미리보기에서 선택한 `{ parentId, index }` |
| `imageSel` / `imageSelAnchor` | 이미지 다중 선택 + Shift 범위 기준 |
| `childDrag` | 계층 DnD / 미리보기로 reparent. `{ parentId, index, refs? }` — **refs**는 드래그 시작 시 고정된 다중 선택 |
| `undoStack` | 스냅샷 스택 |
| `clip` | 복사 버퍼 (레이아웃 서브트리 또는 이미지) |
| `folderWatch` | `{ enabled, rules[] }` — 규칙별 `{ id, folderName, targetLayoutId, handle }` |
| `pngHandle` | IndexedDB에 보관하는 PNG 저장 FileSystemFileHandle |

### 4.2 Layout 객체 (요지)

- `settings`: `width/height`, `pad_*`, `cell_w/h`, `spacing_x/y`, `start_corner`, `start_axis`, `child_align`, `constraint`, `constraint_count` — `grid.js`의 `normalizeSettings`와 동기
- `children[]`: `{ type: "image"|"layout", refId, frame? }`
- `frame`: 캔버스 직속 또는 캔버스 직속 이미지용 `{ x,y,w,h,z }`. 레이아웃 **안** 이미지는 `reflow()`가 frame 채움
- `transparentBg`, `bgColor`, `bgAlpha` (0–1). legacy `transparentBg`만 있는 JSON도 `getBgAlpha()`가 해석
- `visible`: `false`면 **미리보기·PNG export에서 제외** (계층 트리·저장에는 유지)

### 4.3 격자 (`js/grid.js`)

- `ObsGrid.computeGrid(n, settings)` → 셀 `{ x,y,width,height, row,col }`
- **자식 정렬**: 실제 **차지한 셀 그룹** bounding box 기준 (빈 슬롯·과도한 spacing 반영 버그 수정됨)
- `reflow(L)`: 레이아웃 자식 frame 재계산, `z = children 순서 + 1`. 레이아웃 paint/export는 **`childPaintOrder(L)` = children 배열 순서** (z-order와 일치)

### 4.4 프로젝트 JSON

- `kind`: `"obs-grid-designer"`, `version`: `PROJECT_VERSION` (app.js 상수 **1**, 앱 릴리즈 버전과 별개)
- `layouts`, `images`, `canvasId`, `folderWatch` 규칙(폴더 **이름**만; handle은 저장 안 됨)
- 이미지 포함 시 base64 data URL — 로드 시 `blob:` URL로 변환해 성능 개선

---

## 5. 주요 서브시스템

### 5.1 미리보기

- **paint(container, layoutId)**: DOM으로 셀·중첩 레이아웃 그림
- **draw(ctx, layoutId)**: PNG export용 canvas
- 드래그 중 일부 경로는 **셀만 갱신**해 전체 `paint` 비용 절감 (v1.1.0+)
- **Ctrl(⌘)+레이아웃 리사이즈**: 드래그 중 CSS scale 미리보기, mouseup에 px 확정
- 레이아웃 **안** 이미지: 미리보기에서 move/resize **불가** (격자만)

### 5.2 자동 PNG 내보내기

- `#autoExportPng` 기본 ON
- **`canAutoExport()`**: 체크 ON + `pngHandle` 있을 때만 (파일 피커 자동 호출 금지)
- `requestAutoExport(immediate)`: 드래그 중(`drag`)이면 보류; debounce ~280ms
- **Ctrl+S**: PNG, **Ctrl+Shift+S**: JSON 저장 (`preventDefault`로 브라우저 HTML 저장 차단)

### 5.3 폴더 자동 추가

- **추가 ▾ → 자동 설정** 모달. 다중 규칙 (+/−). `enabled` + 규칙별 `showDirectoryPicker` handle
- **폴링**: `FOLDER_POLL_MS = 1000`, debounce **200ms**. `FileSystemObserver` 있으면 보조
- 새 파일: 파일명 키 + **2회 연속 동일 size/mtime** 후 추가 (쓰기 중 오인 방지)
- `localStorage`: `grid-composer-folder-watch`, `grid-composer-folder-seen`
- IndexedDB `obs-grid-designer` / store `handles`: key `watchFolder` 등 handle persist (브라우저·권한 의존)
- UI: 사용 중이면 **추가 ▾** 옆 `auto`, 메뉴 **자동 설정 · ON**

### 5.4 계층 UI

- 레이아웃 접기/펼치기, **눈 아이콘** visibility, **보기 ▾** (썸네일·모두 접기/펼치기)
- 썸네일: `IntersectionObserver` 지연 로드
- **추가 메뉴**: `label for=fileInput` 사용 금지 — 숨김 input이 툴바에 노출됨. **`addImageMenuBtn` → `fileInput.click()`** 패턴 유지
- `fileInput`은 `.actions` 밖, `aria-hidden` + `.file-input` clip

### 5.5 i18n

- `js/i18n.js`: `t(key, vars)`, `data-i18n`, `data-i18n-title`
- **주의**: `copySelection` / `duplicateSelection` 등에서 지역 변수 이름 **`t`로 i18n `t()` 함수를 가리면 안 됨** (과거 Ctrl+D 자동 export 버그 원인). 대상 객체는 `target` 등 사용

### 5.6 다중 이미지 이동

- `moveImagesToLayout(refs, toParentId)`: dedupe 키는 **`parentId + ":" + index`** (복제 이미지는 **같은 refId**를 공유할 수 있음)
- `draggedImageRefs()`: `childDrag.refs` 우선 (드래그 시작 시 스냅샷)

---

## 6. 브라우저 저장소 키 (참고)

| 키 / DB | 용도 |
|---------|------|
| `grid-composer-lang` | UI 언어 |
| `grid-composer-folder-watch` | 자동 추가 enabled + rules 메타 |
| `grid-composer-folder-seen` | 이미 처리한 파일명 |
| `grid-composer-tree-thumbs` | 계층 썸네일 표시 |
| `grid-composer-last-seen-version` | 업데이트 안내 |
| IndexedDB `obs-grid-designer` | PNG handle, watch folder handle(s), **project handle** (key `"project"`) |

---

## 7. UI·코드 관습

- 설정 패널: **라벨 왼쪽 · 입력 오른쪽** 한 줄 (`form-row`). 섹션 `h2`, 긴 설명은 **ⓘ** `hint-tip` + `data-i18n-title`
- 수동 **격자** 버튼 없음 — 설정/자식 변경 시 `reflow()` 자동
- 미리보기 **캔버스 크기 배지** 제거됨 (상단 입력·meta만)
- 자식 정렬: **select + 9칸 align-pad** (패드는 select **아래**)
- 제약: 유형/개수 나란히; `auto`일 때 개수 input **disabled** (hidden 아님)
- 커밋은 **사용자가 요청할 때만** (레포 규칙)

---

## 8. 최근 대화에서 다룬 변경 (히스토리)

아래는 README changelog에 없을 수 있는 **세션 단위** 수정입니다. 코드와 불일치하면 **코드 우선**.

- 자식 정렬: occupied cell group 기준 align (`grid.js`)
- 배경: RGB + 불투명도(0–100), `bgAlpha`
- 폴더 감시 주기 1s / debounce 200ms
- Ctrl+D: `t` 변수 shadowing 수정 + 복제 후 `refresh()` + auto export
- 계층 다중 선택 → 미리보기 레이아웃 drop: **전체 이동** (refId dedupe 제거)
- **마지막 작업 프로젝트 자동 재열기** (1.1.2.3): 열기(`showOpenFilePicker`)·저장(`showSaveFilePicker`) 둘 다 핸들을 `projectHandle`에 두고 IndexedDB `"project"` 키에 저장. 저장은 **항상** 위치를 물음 — 자동 덮어쓰기가 아님. 부팅 시 `queryPermission({mode:"read"})`이 이미 `"granted"`일 때만(사용자 제스처 없이) 조용히 다시 읽어 `importProject()`. 미지원 브라우저는 기존 `<input type=file>`/다운로드로 폴백
- **방향키 nudge** (1.1.2.4): `getNudgeableFrameChild()` — `previewSel`이 가리키는 child가 `isInteractiveChild()`(캔버스 직속 이미지 또는 임의 깊이의 레이아웃 프레임)를 만족할 때만 방향키로 `frame.x/y` ±1px(Shift ±10px) 이동. 레이아웃 그리드 안의 이미지는 frame이 `reflow()`로 계산되므로 대상 아님. undo는 `e.repeat`로 세션 단위 1회만 push(눌린 채로 반복돼도 한 번의 되돌리기로 복원)
- 추가 드롭다운 / file input DOM 정리

---

## 9. 수정 시 자주 건드리는 진입점

| 작업 | 위치 |
|------|------|
| 격자·정렬 수학 | `js/grid.js` → `computeGrid` |
| reflow / add / delete | `reflow`, `makeLayout`, `removeSelected` |
| 미리보기·export | `paint`, `draw`, `refreshPreview`, `runAutoExport` |
| 단축키 | `window.addEventListener("keydown", …)` 하단 |
| 프로젝트 save/load | `saveProject`, `importProject`, `validateProject` |
| 문자열 | `js/i18n.js` ko/en + HTML `data-i18n` |
| 릴리즈 노트 | `js/version.js` + README 변경 이력 |

---

## 10. 알려진 제약·운영 이슈

- OBS 등: PNG 파일 갱신 시 소스 리로드 필요할 수 있음 (튜토리얼 참고)
- 폴더 감시: **탭이 열려 있어야** 동작; handle은 기기·브라우저별
- 프로젝트 JSON을 다른 PC로 옮기면 **폴더 handle 재선택** 필요
- `app.js` 단일 대형 파일 — 기능 추가 시 **기존 패턴**(pushUndo, reflow, requestAutoExport) 따라 최소 diff 권장

---

## 11. 다음 에이전트에게 권장 첫 작업

1. README + `tutorial.html` + 이 문서 읽기  
2. Chrome에서 Pages URL 또는 로컬 `index.html`로 **레이아웃 추가 → 이미지 → PNG / JSON 저장** 한 바퀴  
3. 코드 변경 전 `js/grid.js`와 `reflow` / `moveImagesToLayout` / `folderWatch` grep  
4. 사용자 요청이 UI만이면 `index.html` + `styles.css` + `i18n.js` 동시 수정  
5. 버전 노출 변경 시 **`version.js` + README changelog + GC_CHANGELOG** 동기화  

---

## 12. 연락·법무

- 상업 이용: LICENSE 및 README의 `khassarion@gamil.com` (오타 가능성 있음 — LICENSE와 동일 문자열 유지)
- 커밋·PR·force push 등 git 정책은 **사용자 규칙**을 따를 것

---

*문서 작성: 인수인계용 (에이전트). 앱 버전은 배포 시 `js/version.js`를 확인하세요.*
