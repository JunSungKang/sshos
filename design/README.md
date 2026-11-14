# sshOS(시오스) 시안과 구조 자료 v6 분류

기준일: 2026-11-15. 모든 기존 그림은 직접 그린 설계 시안이며, 실제 제품 실행이나 서버 연결의 증거가 아니다. 현행 기능·수치·창 동작은 [제품 계획](../docs/01-product-plan.md)·[개발 계획](../docs/02-development-plan.md)·[데스크톱 명세](../docs/09-desktop-interaction-spec.md)가 정한다.

| 자료 | 현행 용도 |
| --- | --- |
| [4초 GIF](mockups/desktop-motion-20261115/sshOS-desktop-motion.gif) · [고해상도 PNG](mockups/desktop-motion-20261115/sshOS-desktop-poster.png) | v6 방향을 설명하는 개념 자료. 창 이동·겹침·최소화·복원만 표현한다. 실제 앱, 전체 기능, 성능, 정확한 레이아웃을 검증한 자료가 아니다. |
| [GIF renderer](mockups/desktop-motion-20261115/render-motion.js) · [당시 검사 결과](mockups/desktop-motion-20261115/motion-validation.json) | 재현용 디자인 도구와 그 결과. 원격 SSH 기능은 없다. 검사 결과는 당시 시안의 해시에만 해당한다. |
| [v6 장면 명세](mockups/scene-spec-v6.json) · [v6 시안 입력](preview-prompt.txt) | 다음 시안 제작의 현행 범위. 이번 문서 개정에서 새 GUI 이미지를 생성하지 않는다. |
| [v6 아키텍처](../docs/04-system-architecture.md) | 현행 Mermaid 구조도. 과거 v5 PNG보다 우선한다. |
| [기존 3장·5개 메뉴·v5 구조도와 renderer](../docs/history/v5-before-desktop-20261115/archive-manifest.json) | 구판 그림과 중간 제안을 보존한 기록. v6에 없는 기능이나 구식 5개 영역을 제품 요구로 사용하지 않는다. |

과거 디자인 소스와 manifest는 보존 이력에서 읽을 수 있다. 당시의 검사를 v6 제품 검사로 승격하지 않는다. GIF에 하드코딩된 서버명·시각·SSH 응답·전송률은 예시다. v6 명세가 해당 GIF에 완전히 반영되어 있다고 주장하지 않는다.

사용자는 외부 기본 폴더에 저장하는 이미지 생성 도구의 사용을 허용하지 않았다. 후속 시안은 기존 승인에 따라 workspace 안에서 직접 렌더링하고 임시 자료를 정리한다. 디자인 renderer를 복사한 뒤 제품 구현이 완료됐다고 처리하지 않는다.
