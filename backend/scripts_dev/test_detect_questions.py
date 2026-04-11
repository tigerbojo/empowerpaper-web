"""
開發用：本機跑 detect_questions PoC（直接呼叫 GeminiProvider）
─────────────────────────────────────
PoC 結論（2026-04-11）：
- 對「正常單頁直式雙欄考卷」Gemini 直接吃整張就 14/14 全對
- 不需要 OpenCV 切欄（hybrid 路線最後沒採用）
- 此檔保留作為本地手動測試工具，會把結果視覺化到 test_result.png

執行：
    set EMPOWERPAPER_GEMINI_API_KEY=...
    python scripts_dev/test_detect_questions.py data/uploads/test-normal.jpg
"""

import sys
import time
from pathlib import Path

import cv2
import numpy as np

from app.llm_vision import GeminiProvider


def detect_columns_auto(binary_inv: np.ndarray, max_cols: int = 4) -> list[int]:
    """垂直投影 → 欄切點"""
    H, W = binary_inv.shape
    v_proj = np.sum(binary_inv, axis=0).astype(np.float32) / 255.0
    smooth = cv2.GaussianBlur(v_proj.reshape(-1, 1), (1, 31), 8).flatten()
    text_thresh = max(smooth.max() * 0.08, H * 0.005)
    is_blank = smooth < text_thresh

    gaps = []
    in_gap = False
    start = 0
    for i, b in enumerate(is_blank):
        if b and not in_gap:
            start = i; in_gap = True
        elif not b and in_gap:
            gaps.append((i - start, start, i))
            in_gap = False

    inner = [g for g in gaps if g[1] > W * 0.08 and g[2] < W * 0.92 and g[0] >= W * 0.015]
    inner.sort(reverse=True)
    inner = inner[:max_cols - 1]
    inner.sort(key=lambda g: g[1])
    return [0] + [(g[1] + g[2]) // 2 for g in inner] + [W]


def main(img_path: str):
    raw = Path(img_path).read_bytes()
    img = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    H, W = img.shape[:2]
    print(f'圖片：{W}x{H}')

    # === 1. CV 偵測欄 ===
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, binary_inv = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    col_cuts = detect_columns_auto(binary_inv, max_cols=4)
    n_cols = len(col_cuts) - 1
    print(f'CV 偵測 {n_cols} 欄, x_cuts={col_cuts}')

    # === 2. 每欄獨立丟 Gemini ===
    provider = GeminiProvider()
    print(f'Gemini model: {provider.model}')

    all_boxes = []  # [(col_idx, q_num, x_orig, y_orig, w_orig, h_orig)]
    for col_idx in range(n_cols):
        x0, x1 = col_cuts[col_idx], col_cuts[col_idx + 1]
        col_img = img[:, x0:x1]
        col_h, col_w = col_img.shape[:2]
        print(f'\n>> 欄 {col_idx}: x={x0}-{x1} ({col_w}x{col_h})')

        # 縮小（單欄通常較窄，給 LLM max 1280 high 就夠）
        max_side = 1600
        if max(col_h, col_w) > max_side:
            s = max_side / max(col_h, col_w)
            col_small = cv2.resize(col_img, (int(col_w * s), int(col_h * s)))
        else:
            col_small = col_img
        ok, enc = cv2.imencode('.png', col_small)
        col_bytes = enc.tobytes()
        print(f'   sent {len(col_bytes)} bytes')

        start = time.time()
        try:
            boxes = provider.detect_questions(col_bytes, timeout=120)
        except Exception as exc:
            print(f'   ❌ Gemini 失敗：{exc}')
            continue
        elapsed = time.time() - start
        print(f'   ✅ Gemini 回 {len(boxes)} 題（{elapsed:.1f}s）')

        # bbox 是 normalized 0~1 相對於「這一欄」，換算回原圖
        for b in boxes:
            x_orig = x0 + int(b.x * col_w)
            y_orig = int(b.y * col_h)
            w_orig = int(b.w * col_w)
            h_orig = int(b.h * col_h)
            all_boxes.append((col_idx, b.q_num, x_orig, y_orig, w_orig, h_orig))
            print(f'      q{b.q_num}: {x_orig},{y_orig} {w_orig}x{h_orig}')

    print(f'\n>> 總共 {len(all_boxes)} 題')

    # === 3. 視覺化 ===
    out = img.copy()
    palette = [(0, 200, 255), (255, 100, 100), (100, 255, 100), (255, 200, 50)]
    for col_idx, q_num, x, y, w, h in all_boxes:
        color = palette[col_idx % len(palette)]
        cv2.rectangle(out, (x + 5, y + 5), (x + w - 5, y + h - 5), color, 4)
        cv2.putText(out, f'Q{q_num}', (x + 15, y + 50),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.5, color, 3)

    cv2.imwrite('test_hybrid_v3_result.png', out)
    print('>> 視覺化存到 backend/test_hybrid_v3_result.png')


if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else 'data/uploads/paper-3c2ecc148419.webp'
    main(target)
