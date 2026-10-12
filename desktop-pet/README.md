# 데스크톱 펫

첨부 캐릭터 시트의 8개 포즈를 그대로 잘라 쓴 투명 배경 데스크톱 펫입니다 (Electron).

## 실행 (Windows PowerShell)
`C:\WINDOWS\System32`에서 실행하면 권한 오류가 나므로 사용자 폴더에서 받으세요.
```powershell
cd $HOME
git clone -b claude/jolly-mendel-fji7m3 https://github.com/eunsu7997/t04-board.git
cd t04-board\desktop-pet
npm install
npm start
```

## 조작
- 드래그: 위치 옮기기 (놓으면 화면 아래로 내려감)
- 마우스 올리기: 두리번 반응
- 더블클릭: 신나서 뛰기
- 오른쪽 클릭: 종료

## 동작
| 상태 | 스프라이트 | 움직임 |
|---|---|---|
| 휴식 | idle | 숨쉬듯 미세하게 움직임 |
| 걷기 | walk | 좌우로 천천히 이동 |
| 빠른 이동 | run | 통통 튀며 빠르게 이동 |
| 포즈 | pose / lie | 볼 받치고 흔들기, 엎드려 턱 괴기 |
| 신남 | excited | 제자리 점프 |
| 졸기 | sleep | 꾸벅꾸벅 |
| 두리번 | curious | 고개 갸웃 |
