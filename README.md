# OBS Grid Layout

OBS에서 이미지들을 그리드로 쓰는 도구입니다. 두 가지 방식을 제공합니다.

| 방식 | 용도 |
|------|------|
| **PyQt 앱** | OBS WebSocket으로 **장면 안 기존 소스**를 직접 재배치 |
| **정적 웹 디자이너** (`web/`) | 로컬 이미지를 배치한 뒤 **PNG**로 내보내 OBS 이미지 소스로 추가 |

---

## 1) PyQt — OBS 소스 직접 배치

```bash
pip install -r requirements.txt
python main.py
```

OBS WebSocket(기본 `4455`) 연결 → 장면 불러오기 → 배치

---

## 2) 정적 웹 — 디자이너 (서버·WebSocket 없음)

`web/index.html`을 브라우저로 열면 됩니다. **로컬 웹 서버 불필요**.

- **캔버스** = PNG 해상도 (미리보기에 크기 표시)
- 하위 레이아웃으로 계층 구성, 미리보기에서 드래그 이동·리사이즈
- 이미지 추가 / 드롭으로 레이아웃에 배치
- **크기 변경 시 자식 스케일** 옵션 (Unity Child Scale 유사)
- **PNG** 내보내기 → OBS 이미지 소스

---

## 구조

```
main.py / ui/ / obs/     # PyQt + WebSocket
layout/                  # 그리드 계산 (Python)
web/                     # 정적 디자이너 (HTML/JS)
  index.html
  styles.css
  js/grid.js
  js/app.js
```
