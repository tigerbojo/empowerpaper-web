"""
v11 回歸測試 — 攔截 2026-06-11 修掉的 bug 再發

BUG-R1 洗白缺口：被判定手寫的深色筆跡在 soft 輸出必須變白
        （v10 之前只靠 210~248 淡灰濾鏡，黑筆留灰影）
BUG-R2 互動覆寫：keep_ids 必須真的還原、erase_ids 必須真的擦掉
BUG-R3 元件 id determinism：同圖重跑 id/bbox 必須穩定（互動 UI 的前提）
BUG-R4 API cache + sidecar：cache hit 也要能回元件清單；覆寫結果不污染基準 cache
BUG-R5 假進度條：前端不得再有 simulateProcessing fallback（失敗要誠實報錯）

跑法：cd backend && python -m pytest tests/test_regression_v11.py -v
"""
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.image_cleanup import cleanup_exam_image_opencv  # noqa: E402

# 合成考卷：規律的「印刷字」網格 + 一筆偏離網格的深色「手寫」
PRINT_ROWS = range(100, 620, 70)
HW_ROI = (700, 700, 160, 110)  # x, y, w, h — 文字網格下方的孤立區


# cv2.imread/imwrite 在 CJK 路徑（C:\Users\強哥\...\pytest-of-強哥）會靜默失敗，
# 一律走 imencode/imdecode + bytes I/O
def imwrite_u(path: Path, img: np.ndarray) -> None:
    ok, buf = cv2.imencode('.png', img)
    assert ok
    path.write_bytes(buf.tobytes())


def imread_gray_u(path: Path) -> np.ndarray:
    data = np.frombuffer(path.read_bytes(), np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_GRAYSCALE)


@pytest.fixture(scope='module')
def synthetic_paper(tmp_path_factory):
    img = np.full((900, 1200, 3), 255, np.uint8)
    # 印刷字：每行一排小黑塊（對齊網格、密集）
    for y in PRINT_ROWS:
        for x in range(100, 1100, 24):
            cv2.rectangle(img, (x, y), (x + 12, y + 16), (10, 10, 10), -1)
    # 手寫：深色粗斜線（off-grid + 孤立 → 必被投票擦除）
    hx, hy, hw, hh = HW_ROI
    cv2.line(img, (hx, hy + hh - 10), (hx + hw - 10, hy), (50, 50, 50), 7)
    path = tmp_path_factory.mktemp('data') / 'synthetic.png'
    imwrite_u(path, img)
    return path


def run_cleanup(src, out_dir, name, **kwargs):
    out = out_dir / f'{name}.png'
    art = cleanup_exam_image_opencv(src, out, collect_components=True, **kwargs)
    gray = imread_gray_u(out)
    return art, gray


def roi_pixels(gray, roi):
    x, y, w, h = roi
    return gray[y:y + h, x:x + w]


def find_hw_component(components):
    """找出 bbox 與手寫 ROI 重疊的被擦除元件"""
    hx, hy, hw, hh = HW_ROI
    for c in components:
        if c['erased'] and c['x'] < hx + hw and c['x'] + c['w'] > hx and c['y'] < hy + hh and c['y'] + c['h'] > hy:
            return c
    return None


def test_bug_r1_dark_handwriting_whitened(synthetic_paper, tmp_path):
    """BUG-R1：深色手寫被擦除後，輸出該區域必須接近全白"""
    art, gray = run_cleanup(synthetic_paper, tmp_path, 'base')

    hw_comp = find_hw_component(art.components)
    assert hw_comp is not None, '手寫元件沒有被判定擦除（投票邏輯回歸）'

    hw_area = roi_pixels(gray, HW_ROI)
    assert float(hw_area.mean()) > 245, (
        f'手寫區域平均灰階 {hw_area.mean():.1f} — 深色筆跡沒洗白（BUG-R1 再發）'
    )

    # 印刷字必須還在（不能順手把整頁洗掉）
    first_row_roi = (100, list(PRINT_ROWS)[0] - 5, 1000, 30)
    printed = roi_pixels(gray, first_row_roi)
    assert float(printed.min()) < 120, '印刷字消失了 — 洗白範圍過度擴張'


def test_bug_r2_keep_ids_restores_ink(synthetic_paper, tmp_path):
    """BUG-R2a：keep_ids 還原後，筆跡像素必須重新出現"""
    art, _ = run_cleanup(synthetic_paper, tmp_path, 'base2')
    hw_comp = find_hw_component(art.components)
    assert hw_comp is not None

    art2, gray2 = run_cleanup(synthetic_paper, tmp_path, 'restored', keep_ids=[hw_comp['id']])
    m = {c['id']: c for c in art2.components}
    assert m[hw_comp['id']]['kind'] == 'restored'
    assert not m[hw_comp['id']]['erased']

    hw_area = roi_pixels(gray2, HW_ROI)
    assert float(hw_area.min()) < 180, 'keep_ids 還原後筆跡仍是白的 — 覆寫沒生效'


def test_bug_r2_erase_ids_forces_white(synthetic_paper, tmp_path):
    """BUG-R2b：erase_ids 強制擦除一個印刷元件，該區域必須變白"""
    art, _ = run_cleanup(synthetic_paper, tmp_path, 'base3')
    ink = next(c for c in art.components if not c['erased'] and c['kind'] == 'ink')

    art2, gray2 = run_cleanup(synthetic_paper, tmp_path, 'forced', erase_ids=[ink['id']])
    m = {c['id']: c for c in art2.components}
    assert m[ink['id']]['kind'] == 'forced'
    assert m[ink['id']]['erased']

    area = roi_pixels(gray2, (ink['x'], ink['y'], ink['w'], ink['h']))
    assert float(area.mean()) > 240, 'erase_ids 強制擦除後該元件仍有墨水'


def test_bug_r3_component_ids_deterministic(synthetic_paper, tmp_path):
    """BUG-R3：同圖重跑，元件 id + bbox 必須完全一致（互動 UI 依賴）"""
    a1, _ = run_cleanup(synthetic_paper, tmp_path, 'd1')
    a2, _ = run_cleanup(synthetic_paper, tmp_path, 'd2')
    sig = lambda art: sorted((c['id'], c['x'], c['y'], c['w'], c['h'], c['erased']) for c in art.components)
    assert sig(a1) == sig(a2)


def test_bug_r4_api_cache_returns_components(synthetic_paper, monkeypatch, tmp_path):
    """BUG-R4：API cache hit 也要回元件清單（sidecar）；覆寫結果另存不污染基準"""
    from fastapi.testclient import TestClient
    from app import storage as storage_module
    from app.main import app
    from app.routes import papers as papers_route

    # 隔離 storage 到 tmp，避免污染 data/
    monkeypatch.setattr(storage_module.storage, 'root', tmp_path, raising=False)
    monkeypatch.setattr(storage_module.storage, 'uploads', tmp_path / 'uploads', raising=False)
    monkeypatch.setattr(storage_module.storage, 'cleaned', tmp_path / 'cleaned', raising=False)
    (tmp_path / 'uploads').mkdir()
    (tmp_path / 'cleaned').mkdir()
    papers_route.papers_index.clear()

    client = TestClient(app)
    up = client.post(
        '/api/papers/upload',
        files={'file': ('t.png', synthetic_paper.read_bytes(), 'image/png')},
    )
    assert up.status_code == 200
    pid = up.json()['paper_id']

    body = {'paper_id': pid, 'mode': 'opencv', 'include_components': True}
    r1 = client.post('/api/papers/clean', json=body).json()
    assert r1['status'] == 'completed'
    assert r1['components'], '首次清理沒回元件清單'
    assert r1['image_width'] and r1['image_height']

    r2 = client.post('/api/papers/clean', json=body).json()
    assert r2['job_id'] == 'existing', '第二次沒命中 cache'
    assert r2['components'], 'cache hit 掉了元件清單（sidecar 回歸）'

    erased_id = next(c['id'] for c in r1['components'] if c['erased'])
    r3 = client.post('/api/papers/clean', json={**body, 'keep_ids': [erased_id]}).json()
    assert r3['cleaned_image_url'] != r1['cleaned_image_url'], '覆寫結果覆蓋了基準 cache'
    m = {c['id']: c for c in r3['components']}
    assert m[erased_id]['kind'] == 'restored'


def test_bug_r5_no_fake_progress_fallback():
    """BUG-R5：前端不得再出現 simulateProcessing 假進度條；失敗路徑要有重試"""
    upload_jsx = (BACKEND.parent / 'src' / 'pages' / 'Upload.jsx').read_text(encoding='utf-8')
    assert 'simulateProcessing' not in upload_jsx, (
        '假進度條 fallback 回歸 — 失敗時必須誠實顯示錯誤，不能假裝成功'
    )
    assert 'processError' in upload_jsx, '失敗錯誤狀態（processError）被移除'
    assert '重試' in upload_jsx, '錯誤 banner 的重試按鈕被移除'
