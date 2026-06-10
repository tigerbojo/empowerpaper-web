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
# 印刷數學符號（+ / = / 小數點），放在文字行中段的空隙 — BUG-R6 的受測對象
# 注意：黑塊格點是 x = 100 + 24k，空隙必須選真正的格點值
OP_ROW_Y = 240
OP_GAP_XS = (580, 604, 628)  # 該行這幾個 x 不畫黑塊，留給符號
OP_PLUS_ROI = (580, 242, 14, 14)
OP_EQ_ROI = (604, 243, 14, 12)
OP_DOT_ROI = (630, 250, 4, 4)
# 聯立方程式大括號（跨兩行的高瘦曲線）— BUG-R7 的受測對象
BRACE_ROI = (72, 100, 16, 92)
# 紅筆劃過印刷字 — BUG-R8 的受測對象
REDPEN_PRINT_ROI = (820, 380, 30, 20)   # 被紅線劃過的黑色印刷塊
REDPEN_ONLY_ROI = (856, 370, 40, 14)    # 純紅筆段（必須被清除）
# 淡彩色筆跡（HSV 窄域抓不到、寫在文字行上 off-grid 也救不了）— v12 彩度票受測
PALE_ROW_Y = 450
PALE_GAP_XS = (508, 532)
PALE_PEN_ROI = (502, 452, 44, 16)


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
    # 印刷字：每行一排小黑塊（對齊網格、密集）；符號行/淡彩筆行留空隙
    for y in PRINT_ROWS:
        for x in range(100, 1100, 24):
            if y == OP_ROW_Y and x in OP_GAP_XS:
                continue
            if y == PALE_ROW_Y and x in PALE_GAP_XS:
                continue
            cv2.rectangle(img, (x, y), (x + 12, y + 16), (10, 10, 10), -1)
    # 手寫：深色粗斜線（off-grid + 孤立 → 必被投票擦除）
    hx, hy, hw, hh = HW_ROI
    cv2.line(img, (hx, hy + hh - 10), (hx + hw - 10, hy), (50, 50, 50), 7)
    # 印刷數學符號：細筆畫的 + / = / 小數點，貼著第三行文字（on-grid）
    # 模擬 PDF render 反鋸齒的偏淡筆畫（灰 90，比黑塊 10 淡）
    px, py = OP_PLUS_ROI[0], OP_PLUS_ROI[1]
    cv2.line(img, (px, py + 7), (px + 13, py + 7), (90, 90, 90), 2)
    cv2.line(img, (px + 6, py), (px + 6, py + 13), (90, 90, 90), 2)
    ex, ey = OP_EQ_ROI[0], OP_EQ_ROI[1]
    cv2.line(img, (ex, ey + 3), (ex + 13, ey + 3), (90, 90, 90), 2)
    cv2.line(img, (ex, ey + 9), (ex + 13, ey + 9), (90, 90, 90), 2)
    dx, dy = OP_DOT_ROI[0], OP_DOT_ROI[1]
    cv2.rectangle(img, (dx, dy), (dx + 3, dy + 3), (60, 60, 60), -1)
    # 聯立方程式大括號：跨第 1、2 行的高瘦曲線（印刷）
    bx, by = BRACE_ROI[0], BRACE_ROI[1]
    brace_pts = np.array([
        (bx + 13, by), (bx + 5, by + 12), (bx + 5, by + 36),
        (bx, by + 46), (bx + 5, by + 56), (bx + 5, by + 80), (bx + 13, by + 90),
    ], dtype=np.int32)
    cv2.polylines(img, [brace_pts], False, (10, 10, 10), 2)
    # 紅筆劃過印刷字：黑色印刷塊 + 紅線（與印刷重疊處混色成暗紅）
    rx, ry, rw2, rh2 = REDPEN_PRINT_ROI
    cv2.rectangle(img, (rx, ry), (rx + rw2, ry + rh2), (10, 10, 10), -1)
    cv2.line(img, (rx - 20, ry + 26), (rx + rw2 + 46, ry - 8), (40, 40, 220), 4)  # 純紅段
    # 與印刷塊重疊的線段手動畫成暗紅（模擬墨水混色，V 低）
    cv2.line(img, (rx + 2, ry + 14), (rx + rw2 - 2, ry + 4), (25, 25, 70), 4)
    # 淡藍筆跡寫在文字行的空隙（on-grid、密集區 → 舊投票全失效；
    # 飽和度 ~25 低於 HSV inpaint 門檻 → 只有 v12 彩度票能抓）
    pxx, pyy = PALE_PEN_ROI[0], PALE_PEN_ROI[1]
    cv2.line(img, (pxx + 4, pyy + 12), (pxx + 40, pyy + 3), (200, 185, 178), 4)
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


def test_bug_r6_math_operators_preserved(synthetic_paper, tmp_path):
    """BUG-R6：印刷的 + / = / 小數點不得被擦除（細筆畫偏淡 ≠ 手寫）

    2026-06-11 v11 faint 投票誤殺案例：聯立方程式的 +、=、小數點全消失，
    題目無法判讀。faint 投票必須有尺寸門檻；二值化雜點門檻不能殺小數點。
    """
    _, gray = run_cleanup(synthetic_paper, tmp_path, 'ops')
    for name, roi in [('plus', OP_PLUS_ROI), ('equals', OP_EQ_ROI), ('dot', OP_DOT_ROI)]:
        area = roi_pixels(gray, roi)
        # 符號模擬反鋸齒淡筆畫（灰 90），保留下來輸出約 200-210；
        # 被擦掉會是 ~255。門檻 230 區分「淡但在」vs「消失」
        assert float(area.min()) < 230, f'印刷符號 {name} 被擦掉了（BUG-R6 再發）'


def test_bug_r7_brace_preserved(synthetic_paper, tmp_path):
    """BUG-R7：聯立方程式的大括號（跨行高瘦曲線）不得被擦除

    大括號跨兩行 → 行投影判它 off-grid；高瘦 → 極端長寬比 +1 票。
    2026-06-12 用戶回報聯立方程式左側大括號消失。
    """
    _, gray = run_cleanup(synthetic_paper, tmp_path, 'brace')
    area = roi_pixels(gray, BRACE_ROI)
    assert float(area.min()) < 180, '大括號被擦掉了（BUG-R7 再發）'


def test_bug_r8_print_under_red_pen_kept(synthetic_paper, tmp_path):
    """BUG-R8：紅筆劃過的印刷字必須保留（暗色像素不當色筆 inpaint）

    2026-06-12 用戶回報：13/5 的 13 被紅筆遮蓋，inpaint 把印刷字一起抹掉。
    與印刷重疊的色筆像素 V 低 → 不進 color mask；純色筆段照樣清除。
    """
    _, gray = run_cleanup(synthetic_paper, tmp_path, 'redpen')
    printed = roi_pixels(gray, REDPEN_PRINT_ROI)
    assert float(printed.min()) < 120, '被紅筆劃過的印刷塊消失了（BUG-R8 再發）'
    red_only = roi_pixels(gray, REDPEN_ONLY_ROI)
    assert float(red_only.mean()) > 235, '純紅筆段沒被清乾淨'


def test_v12_pale_colored_pen_erased(synthetic_paper, tmp_path):
    """v12-A：淡彩色筆跡（HSV 窄域抓不到、on-grid）必須被彩度票擦掉

    使用者觀察：考卷是灰階印刷，帶彩度的筆畫必然是後加的。
    寫在印刷文字行上的淡藍筆，off-grid/isolated/faint 全部失效，
    只有元件彩度（相對頁面基準）能識別。
    """
    _, gray = run_cleanup(synthetic_paper, tmp_path, 'palepen')
    area = roi_pixels(gray, PALE_PEN_ROI)
    assert float(area.mean()) > 235, '淡彩色筆跡沒被擦掉（v12 彩度票失效）'


def test_bug_r5_no_fake_progress_fallback():
    """BUG-R5：前端不得再出現 simulateProcessing 假進度條；失敗路徑要有重試"""
    upload_jsx = (BACKEND.parent / 'src' / 'pages' / 'Upload.jsx').read_text(encoding='utf-8')
    assert 'simulateProcessing' not in upload_jsx, (
        '假進度條 fallback 回歸 — 失敗時必須誠實顯示錯誤，不能假裝成功'
    )
    assert 'processError' in upload_jsx, '失敗錯誤狀態（processError）被移除'
    assert '重試' in upload_jsx, '錯誤 banner 的重試按鈕被移除'
