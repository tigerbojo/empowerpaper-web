import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .schemas import CleanupMode, CleanupProcessor

# 擦除管線版本 — 進 cache key。演算法有感變更時 bump，
# 否則舊的 cleaned cache 會把修復前的結果一直吐給使用者
PIPELINE_VERSION = 'v13'


@dataclass
class CleanupArtifacts:
    processor: CleanupProcessor
    cleaned_path: Path
    ocr_path: Path | None = None
    components: list[dict] | None = None
    image_width: int | None = None
    image_height: int | None = None
    sample_result: dict | None = None


def _load_image(path: Path) -> np.ndarray:
    data = np.frombuffer(path.read_bytes(), dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError('無法讀取上傳圖片，請確認檔案格式是否正確')
    return image


def _resize_if_needed(image: np.ndarray, max_side: int = 2200) -> np.ndarray:
    height, width = image.shape[:2]
    longest = max(height, width)
    if longest <= max_side:
        return image
    scale = max_side / float(longest)
    new_size = (int(width * scale), int(height * scale))
    return cv2.resize(image, new_size, interpolation=cv2.INTER_AREA)


def _remove_colored_marks(image: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    blue_mask = cv2.inRange(hsv, np.array([90, 30, 35]), np.array([140, 255, 255]))
    red_mask_1 = cv2.inRange(hsv, np.array([0, 35, 40]), np.array([12, 255, 255]))
    red_mask_2 = cv2.inRange(hsv, np.array([160, 35, 40]), np.array([179, 255, 255]))
    color_mask = cv2.bitwise_or(blue_mask, cv2.bitwise_or(red_mask_1, red_mask_2))

    # 很暗的像素不當色筆：印刷墨水被色筆劃過時混色成暗紅/暗藍（V 低），
    # 底下是原題內容 — inpaint 它會把被遮的印刷字一起抹掉、無法判讀。
    # 保留暗像素，殘餘色暈交給後段灰階管線清理。
    dark_ink = hsv[:, :, 2] < 80
    color_mask[dark_ink] = 0

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    color_mask = cv2.dilate(color_mask, kernel, iterations=1)
    color_mask = cv2.medianBlur(color_mask, 5)

    if int(np.count_nonzero(color_mask)) < 80:
        return image

    return cv2.inpaint(image, color_mask, 5, cv2.INPAINT_NS)


def _normalize_document_background(gray: np.ndarray) -> np.ndarray:
    background = cv2.GaussianBlur(gray, (0, 0), sigmaX=25, sigmaY=25)
    normalized = cv2.divide(gray, background, scale=255)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(normalized)
    return cv2.fastNlMeansDenoising(enhanced, None, 6, 7, 21)


def _binarize_document(gray: np.ndarray) -> np.ndarray:
    adaptive = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 25, 12)
    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # bitwise_or = 取「兩者都認為是墨水」的交集。稀疏頁（大片空白）的
    # Otsu 門檻會亂掉、把整頁文字判成背景 → 交集後 binary 幾乎全白，
    # 整頁印刷字消失。Otsu 抓到的墨水比例異常低時，只信 adaptive。
    otsu_ink_ratio = float(np.mean(otsu == 0))
    if otsu_ink_ratio < 0.005:
        binary = adaptive
    else:
        binary = cv2.bitwise_or(adaptive, otsu)

    open_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, open_kernel, iterations=1)

    # 雜點門檻 6px：再高會殺掉印刷的小數點（~9px），
    # 殘留的微小雜訊交給後段 residual gray 濾鏡處理
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(255 - binary, connectivity=8)
    cleaned = binary.copy()
    for label in range(1, num_labels):
        if stats[label, cv2.CC_STAT_AREA] < 6:
            cleaned[labels == label] = 255

    return cleaned


def _detect_text_grid(binary: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """雙向投影：偵測印刷文字的水平行 + 垂直列"""
    h, w = binary.shape
    text_inv = (255 - binary) / 255.0

    h_proj = np.sum(text_inv, axis=1) / w
    h_proj_smooth = cv2.GaussianBlur(
        h_proj.astype(np.float32).reshape(-1, 1), (1, 21), 5
    ).flatten()
    h_in_line = (h_proj_smooth > 0.04).astype(np.uint8)

    v_proj = np.sum(text_inv, axis=0) / h
    v_proj_smooth = cv2.GaussianBlur(
        v_proj.astype(np.float32).reshape(-1, 1), (1, 21), 5
    ).flatten()
    v_in_line = (v_proj_smooth > 0.04).astype(np.uint8)

    return h_in_line, v_in_line


def _detect_chart_regions(binary: np.ndarray) -> np.ndarray:
    """
    偵測圖表/表格/幾何圖形區域，回傳 bool mask（True = 保護區，不可清除）

    對數學考卷至關重要：座標軸、表格線、幾何圖、函數圖
    在 _remove_gray_marks 投票時很容易被誤判成手寫。

    策略：
    1. 長直線（水平 + 垂直）→ 表格、座標軸、刻度線
    2. 大型連通元件 → 幾何圖、函數圖
    3. dilate 形成保護區
    4. 安全閥：保護區 > 60% 視為偵測失敗，回傳全空
    """
    h, w = binary.shape
    inv = (255 - binary).astype(np.uint8)
    img_area = h * w

    # 1. 長直線（kernel 長度約 = 圖片邊長 / 25，至少 40px）
    h_kernel_len = max(40, w // 25)
    v_kernel_len = max(40, h // 25)
    h_lines = cv2.morphologyEx(
        inv, cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_RECT, (h_kernel_len, 1)),
    )
    v_lines = cv2.morphologyEx(
        inv, cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_RECT, (1, v_kernel_len)),
    )
    lines = cv2.bitwise_or(h_lines, v_lines)

    # 2. 大型連通元件（幾何圖、函數圖）
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(inv, connectivity=8)
    large_mask = np.zeros_like(inv)
    for label in range(1, num_labels):
        area = stats[label, cv2.CC_STAT_AREA]
        cw = stats[label, cv2.CC_STAT_WIDTH]
        ch = stats[label, cv2.CC_STAT_HEIGHT]
        bbox_area = cw * ch
        # bbox 至少占整圖 2%，且邊長 >= 100px，且實際面積 > 200
        if bbox_area > img_area * 0.02 and max(cw, ch) >= 100 and area > 200:
            large_mask[labels == label] = 255

    seed = cv2.bitwise_or(lines, large_mask)

    # 3. dilate 把附近區域納入保護（避免邊緣被切掉）
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21))
    chart_region = cv2.dilate(seed, kernel, iterations=2)
    chart_bool = chart_region > 0

    # 4. 安全閥：保護區占比過大 → 偵測失敗，放棄保護
    if float(np.mean(chart_bool)) > 0.6:
        return np.zeros_like(chart_bool)

    return chart_bool


def _classify_components(
    enhanced: np.ndarray,
    original_binary: np.ndarray,
    chart_mask: np.ndarray,
    cc: tuple,
    keep_set: set[int],
    erase_set: set[int],
    color_image: np.ndarray | None = None,
    sample_points: list[tuple[float, float]] | None = None,
) -> dict[int, dict]:
    """
    v11: 元件級分類（取代 v4 _remove_gray_marks 的 in-place 清除）

    對每個連通元件做投票判定，回傳 {label: decision} 字典：
      decision = {erased: bool, kind: str, votes: int, bbox: (x,y,w,h)}
      kind: 'removed'（自動判手寫）| 'forced'（使用者強制擦除）|
            'restored'（使用者救回）| 'candidate'（疑似手寫但保留）|
            'ink'（一般印刷墨水）| 'noise'（小雜點）

    投票信號：
    - 偏離印刷行列（雙向投影）= 2 票
    - 周圍文字密度低（孤立筆跡）= 2 票
    - ★ v11 新增：筆畫明顯比全頁印刷墨水淡（鉛筆/原子筆輕壓）= 2 票
      —— 專治「答案寫在印刷文字行上」的填空題，行列對齊投票對它無效
    - 形狀特徵（低密度 / 極端長寬比 / 大面積）各 1 票
    - 細小符號與細長形（√、括號、底線）永不自動擦除（v9 rescue 移到此處）

    使用者覆寫：keep_set 強制保留、erase_set 強制擦除，優先於所有投票。
    """
    num_labels, labels, stats, _ = cc
    h_img, w_img = original_binary.shape

    h_in_line, v_in_line = _detect_text_grid(original_binary)

    text_inv_norm = (255 - original_binary).astype(np.float32) / 255.0
    density_map = cv2.GaussianBlur(text_inv_norm, (51, 51), 15)

    # 稀疏頁安全閥：整頁墨水比例過低（計算題頁、答案卷）時，
    # 「孤立」與「偏離行列」訊號都失去鑑別力 —— 整頁空曠時什麼都孤立、
    # 稀疏的印刷行墨水量低於行投影門檻而不被承認是行。
    # 此時寧可少擦（保內容），漏網筆跡交給互動式擦除。
    page_ink_ratio = float(np.mean(text_inv_norm))
    is_sparse_page = page_ink_ratio < 0.03
    isolation_weight = 0 if is_sparse_page else 2
    off_grid_weight = 1 if is_sparse_page else 2

    # 每個元件的平均灰階（vectorized：bincount 加總 / 像素數）
    flat_labels = labels.ravel()
    sums = np.bincount(flat_labels, weights=enhanced.ravel().astype(np.float64), minlength=num_labels)
    counts = np.bincount(flat_labels, minlength=num_labels).astype(np.float64)
    counts[counts == 0] = 1
    mean_intensity = sums / counts

    # 全頁印刷墨水的參考濃度：取「夠黑」元件的中位數（排除淡筆跡拉高基準）
    ink_means = [
        mean_intensity[label]
        for label in range(1, num_labels)
        if stats[label, cv2.CC_STAT_AREA] >= 15
    ]
    ink_ref = float(np.median(ink_means)) if ink_means else 100.0

    # ★ v12-A: 元件平均彩度。灰階印刷 R≈G≈B（彩度~0），帶彩度的筆畫
    # 必然是後加的（藍筆/紅筆/螢光筆，含 HSV 窄域抓不到的淡色筆）。
    # 用「相對頁面基準」免疫手機拍照的整體色偏。
    # SCUT 校準：印刷 Δchroma p99=5.2、手寫 p75=39 → 門檻 8 幾乎零誤殺
    if color_image is not None:
        chroma = (
            color_image.max(axis=2).astype(np.int16)
            - color_image.min(axis=2).astype(np.int16)
        ).astype(np.float64)
        mean_chroma = np.bincount(flat_labels, weights=chroma.ravel(), minlength=num_labels) / counts
        chroma_samples = [
            mean_chroma[label]
            for label in range(1, num_labels)
            if stats[label, cv2.CC_STAT_AREA] >= 15
        ]
        chroma_base = float(np.median(chroma_samples)) if chroma_samples else 0.0
    else:
        mean_chroma = np.zeros(num_labels)
        chroma_base = 0.0

    # ★ v12-C: 字高規律性。印刷字高在同一行內是量化的；
    # 高度明顯超出行中位數的元件 = 手寫嫌疑。
    # SCUT 校準：印刷 ratio p95=1.35、手寫 p75=1.45 → 門檻 1.6
    row_ids = np.full(h_img, -1, dtype=np.int32)
    rid = -1
    prev_in = 0
    for yy in range(h_img):
        cur = int(h_in_line[yy])
        if cur and not prev_in:
            rid += 1
        row_ids[yy] = rid if cur else -1
        prev_in = cur
    comp_row = {}
    row_heights: dict[int, list[int]] = {}
    for label in range(1, num_labels):
        y = int(stats[label, cv2.CC_STAT_TOP])
        ch_ = int(stats[label, cv2.CC_STAT_HEIGHT])
        cy_ = min(y + ch_ // 2, h_img - 1)
        r = int(row_ids[cy_])
        comp_row[label] = r
        if r >= 0 and stats[label, cv2.CC_STAT_AREA] >= 15:
            row_heights.setdefault(r, []).append(ch_)
    row_median_h = {
        r: float(np.median(v)) for r, v in row_heights.items() if len(v) >= 4
    }
    # 全元件中心點（v12-C 的容器判定用）
    centers_x = stats[:, cv2.CC_STAT_LEFT] + stats[:, cv2.CC_STAT_WIDTH] // 2
    centers_y = stats[:, cv2.CC_STAT_TOP] + stats[:, cv2.CC_STAT_HEIGHT] // 2
    areas_all = stats[:, cv2.CC_STAT_AREA]

    # ★ v13: 筆跡樣本匹配（exemplar matching）。使用者點 3-5 處筆跡，
    # 萃取「這張卷的這支筆」的特徵（濃度/彩度/筆畫粗細），
    # 對全頁元件做貼身匹配 — 全域門檻做不到的 per-paper 校準。
    sample_match: np.ndarray | None = None
    sample_info: dict | None = None
    if sample_points:
        ink_u8 = (original_binary == 0).astype(np.uint8)
        dt = cv2.distanceTransform(ink_u8, cv2.DIST_L2, 3).astype(np.float64)
        dt_mean = np.bincount(flat_labels, weights=dt.ravel(), minlength=num_labels) / counts

        exemplar_labels: list[int] = []
        for nx, ny in sample_points:
            px = int(np.clip(nx * w_img, 0, w_img - 1))
            py = int(np.clip(ny * h_img, 0, h_img - 1))
            lbl = int(labels[py, px])
            if lbl == 0:
                # 點到空白 → 找 12px 半徑內最近的墨水元件
                y0, y1 = max(0, py - 12), min(h_img, py + 13)
                x0, x1 = max(0, px - 12), min(w_img, px + 13)
                patch = labels[y0:y1, x0:x1]
                nz = patch[patch > 0]
                lbl = int(np.bincount(nz).argmax()) if nz.size else 0
            if lbl > 0 and stats[lbl, cv2.CC_STAT_AREA] >= 8:
                exemplar_labels.append(lbl)

        if exemplar_labels:
            ex_i = float(np.median([mean_intensity[l] for l in exemplar_labels]))
            ex_c = float(np.median([mean_chroma[l] for l in exemplar_labels]))
            ex_w = float(np.median([dt_mean[l] for l in exemplar_labels]))
            i_spread = max(14.0, 2.0 * float(np.std([mean_intensity[l] for l in exemplar_labels])))

            # 漸進收緊：匹配面 > 35% 表示範圍太鬆（筆跡與印刷特徵接近），
            # 逐步縮小灰度容差搶救「最像樣本」的那批；縮到 5 還是太廣
            # 才放棄（= 特徵物理不可分），並回報原因
            n_comps = int((areas_all[1:] >= 15).sum())
            for spread in [i_spread, 10.0, 7.0, 5.0]:
                if spread > i_spread:
                    continue
                cand = (
                    (areas_all >= 15)
                    & (np.abs(mean_intensity - ex_i) <= spread)
                    & (np.abs(mean_chroma - ex_c) <= 12)
                    & (dt_mean >= 0.55 * ex_w) & (dt_mean <= 1.8 * ex_w)
                )
                cand[0] = False
                if n_comps > 0 and int(cand.sum()) / n_comps <= 0.35:
                    sample_match = cand
                    break
            if sample_match is not None:
                for l in exemplar_labels:
                    sample_match[l] = True
                sample_info = {
                    'applied': True,
                    'matched': int(sample_match.sum()),
                    'reason': None,
                }
            else:
                sample_info = {
                    'applied': False,
                    'matched': 0,
                    'reason': 'indistinguishable',  # 筆跡與印刷特徵不可分
                }
        else:
            sample_info = {'applied': False, 'matched': 0, 'reason': 'no_ink_at_points'}

    # ★ v12-D: 版面先驗 — 文字欄起始線。台灣考卷學生答案常用鉛筆寫在
    # 題號「左側的 margin」；褪色影印卷上鉛筆與印刷的濃度/紋理完全不可分，
    # 唯一可靠的訊號是位置：印刷每行的起始 x 高度一致（題號/選項欄位），
    # 起始線左外側的元件 = 手寫答案。
    # v12e 多欄支援：先用垂直投影切出欄位區塊，每欄各算自己的起始線
    # （取該欄每行最左元件 x 的中位數；被答案拉偏的行是少數，中位數穩健），
    # 單面雙欄考卷的右欄答案才接得住。
    column_blocks: list[tuple[int, int]] = []  # (x_start, x_end)
    in_run = False
    run_start = 0
    for xx in range(w_img + 1):
        on = bool(v_in_line[xx]) if xx < w_img else False
        if on and not in_run:
            in_run = True
            run_start = xx
        elif not on and in_run:
            in_run = False
            # 與前一塊距離 < 40px 視為同一欄（行內字距造成的小縫）
            if column_blocks and run_start - column_blocks[-1][1] < 40:
                column_blocks[-1] = (column_blocks[-1][0], xx)
            else:
                column_blocks.append((run_start, xx))
    # 只留真正的欄（寬度 >= 15% 頁寬），太窄的（裝訂線、雜訊）併入鄰欄判定
    column_blocks = [b for b in column_blocks if b[1] - b[0] >= w_img * 0.15]

    # 守門：相鄰兩塊之間必須是「貫穿整頁的白色走廊」才算真正的欄位分隔。
    # 單欄考卷的版面空帶（圖旁留白、縮排）不會整頁淨空，會被這裡併回去，
    # 避免把單欄誤切成雙欄、用錯的起始線誤殺行內內容。
    ink_bool = original_binary < 128
    merged_blocks: list[tuple[int, int]] = []
    for blk in column_blocks:
        if merged_blocks:
            gap_x0, gap_x1 = merged_blocks[-1][1], blk[0]
            if gap_x1 - gap_x0 >= 8:
                strip_ink_rows = float(ink_bool[:, gap_x0:gap_x1].any(axis=1).mean())
            else:
                strip_ink_rows = 1.0
            if strip_ink_rows > 0.10:
                merged_blocks[-1] = (merged_blocks[-1][0], blk[1])
                continue
        merged_blocks.append(blk)
    column_blocks = merged_blocks

    def _column_of(cx_: int) -> int:
        for idx, (bx0, bx1) in enumerate(column_blocks):
            if cx_ < bx1:
                return idx  # 在欄內或欄前的 margin 區 → 屬於這一欄
        return len(column_blocks) - 1

    col_row_x0: dict[tuple[int, int], int] = {}  # (col, row) -> 最左 x
    for label in range(1, num_labels):
        r = comp_row.get(label, -1)
        if r >= 0 and stats[label, cv2.CC_STAT_AREA] >= 15:
            x_ = int(stats[label, cv2.CC_STAT_LEFT])
            c_ = _column_of(x_ + int(stats[label, cv2.CC_STAT_WIDTH]) // 2)
            key = (c_, r)
            if key not in col_row_x0 or x_ < col_row_x0[key]:
                col_row_x0[key] = x_
    column_x0_by_col: dict[int, float] = {}
    for c_ in range(len(column_blocks)):
        xs_ = [v for (cc_, _), v in col_row_x0.items() if cc_ == c_]
        if len(xs_) >= 5:
            column_x0_by_col[c_] = float(np.median(xs_))

    decisions: dict[int, dict] = {}

    for label in range(1, num_labels):
        x = int(stats[label, cv2.CC_STAT_LEFT])
        y = int(stats[label, cv2.CC_STAT_TOP])
        cw = int(stats[label, cv2.CC_STAT_WIDTH])
        ch = int(stats[label, cv2.CC_STAT_HEIGHT])
        area = int(stats[label, cv2.CC_STAT_AREA])
        bbox = (x, y, cw, ch)

        if label in erase_set:
            decisions[label] = {'erased': True, 'kind': 'forced', 'votes': 0, 'bbox': bbox, 'area': area}
            continue

        # 小雜點直接清除（不進元件清單）；門檻與 _binarize_document 對齊，
        # 不能殺掉印刷小數點（~7-9px）
        if area < 6:
            decisions[label] = {'erased': True, 'kind': 'noise', 'votes': 0, 'bbox': bbox, 'area': area}
            continue

        # 形狀特徵
        bbox_area = max(cw * ch, 1)
        density = area / bbox_area
        aspect = cw / max(ch, 1)

        # 細小符號 / 細長形（v9 rescue 條件）：永不自動擦除
        is_tiny_symbol = 8 < area < 250 and density > 0.25 and 0.2 < aspect < 5.0
        is_thin_shape = (
            8 < area < 400
            and (
                (0.15 < aspect < 0.5 and ch < 40)
                or (2.0 < aspect < 8.0 and cw < 60)
            )
        )
        # 字符尺寸的低密度形狀（＋ 號是十字形，bbox 密度只有 ~0.14，
        # 上面兩個條件都接不住）— 永不自動擦除，誤留交給互動式擦除
        is_small_glyph = area < 60 and max(cw, ch) <= 20 and density > 0.10
        # 高瘦的低密度形狀 = 聯立方程式大括號 / 长括号 / 積分號。
        # 跨兩行所以行投影會判它 off-grid，必須獨立保護。
        # density < 0.6 排除「實心直線」（手寫刪除線、表格線交給其他機制）
        is_tall_bracket = (
            aspect < 0.22
            and 40 <= ch <= 220
            and density < 0.6
            and area < 2500
        )
        is_protected_shape = is_tiny_symbol or is_thin_shape or is_small_glyph or is_tall_bracket

        # 行列對齊度
        h_ratio = float(np.mean(h_in_line[y:min(y + ch, h_img)])) if ch else 0.0
        v_ratio = float(np.mean(v_in_line[x:min(x + cw, w_img)])) if cw else 0.0
        is_off_grid = h_ratio < 0.5 and v_ratio < 0.5

        # 局部密度（中心點周圍）
        cy = min(y + ch // 2, h_img - 1)
        cx = min(x + cw // 2, w_img - 1)
        is_isolated = float(density_map[cy, cx]) < 0.05

        # ★ v11: 筆畫濃度（比印刷墨水基準淡很多 = 手寫鉛筆/輕壓筆跡）
        # v11.1: 加尺寸門檻 — 印刷的小符號（＋ ＝ － 小數點）筆畫細，
        # 反鋸齒會讓平均灰階偏淡，不加門檻會被誤判成淡筆跡擦掉
        is_faint = (
            area >= 60
            and max(cw, ch) >= 25
            and float(mean_intensity[label]) > ink_ref + 30
        )

        # ★ v12-A: 帶彩度 = 色筆筆跡（印刷是灰階）。強訊號，
        # 連形狀保護/圖表保護都可以蓋過（紅勾、圖上的色筆標記照樣擦）
        is_colored = (
            area >= 15
            and float(mean_chroma[label]) - chroma_base > 8
            and float(mean_chroma[label]) > 10
        )

        # ★ v12-C: 高度明顯超出同行印刷字高 = 手寫嫌疑。
        # 例外：bbox 內包著其他元件的「容器」（題目插圖的圈圈、框住文字
        # 的圖形）天生比行高大，不投票
        row_of = comp_row.get(label, -1)
        is_oversized = (
            area >= 15
            and row_of in row_median_h
            and ch > 1.6 * row_median_h[row_of]
        )
        if is_oversized:
            inside = (
                (centers_x > x) & (centers_x < x + cw)
                & (centers_y > y) & (centers_y < y + ch)
                & (areas_all >= 15)
            )
            inside[label] = False
            if int(np.count_nonzero(inside)) >= 1:
                is_oversized = False

        # ★ v12-D/e: 在所屬欄位起始線左外側（margin 區）的元件 = 手寫答案。
        # 右緣完整落在該欄起始線左側、且尺寸是字母級（非雜點）才算
        comp_col = _column_of(cx) if column_blocks else -1
        col_x0 = column_x0_by_col.get(comp_col, -1.0)
        is_margin = (
            col_x0 > 0
            and area >= 40
            and (x + cw) < col_x0 - 8
        )

        # ★ v13: 與使用者標記的筆跡樣本特徵相符
        is_like_sample = bool(sample_match[label]) if sample_match is not None else False

        votes = 0
        if is_off_grid:
            votes += off_grid_weight
        if is_isolated:
            votes += isolation_weight
        if is_faint:
            votes += 2
        if is_colored:
            votes += 2
        if is_margin:
            votes += 2
        if is_like_sample:
            votes += 2
        if is_oversized:
            votes += 1
        if density < 0.2:
            votes += 1
        if aspect > 5 or aspect < 0.2:
            votes += 1
        if area > 4000:
            votes += 1

        if label in keep_set:
            decisions[label] = {'erased': False, 'kind': 'restored', 'votes': votes, 'bbox': bbox, 'area': area}
            continue

        # 圖表保護：中心點落在圖表區 → 保留，但高票元件標成 candidate 供使用者手動擦。
        # 彩度票「不」蓋過保護 — 雙色印刷考卷（彩色圈圈/插圖）存在，
        # 圖上的色筆標記寧可留給互動式擦除，不冒險誤殺印刷圖形
        in_chart = bool(chart_mask[cy, cx])
        if in_chart:
            kind = 'candidate' if votes >= 2 else 'ink'
            decisions[label] = {'erased': False, 'kind': kind, 'votes': votes, 'bbox': bbox, 'area': area}
            continue

        # 形狀保護不適用於 margin 區（欄位起始線外不會有印刷小符號）
        # 與筆跡樣本相符的元件同樣不受形狀保護（使用者親自示範的證據）
        if votes >= 2 and (not is_protected_shape or is_margin or is_like_sample):
            decisions[label] = {'erased': True, 'kind': 'removed', 'votes': votes, 'bbox': bbox, 'area': area}
        else:
            kind = 'candidate' if votes >= 1 else 'ink'
            decisions[label] = {'erased': False, 'kind': kind, 'votes': votes, 'bbox': bbox, 'area': area}

    return decisions, sample_info


def _build_removed_mask(labels: np.ndarray, decisions: dict[int, dict]) -> np.ndarray:
    """被擦除元件的像素 mask（bool）"""
    erased_labels = [label for label, d in decisions.items() if d['erased']]
    if not erased_labels:
        return np.zeros(labels.shape, dtype=bool)
    return np.isin(labels, np.asarray(erased_labels, dtype=labels.dtype))


def _components_payload(decisions: dict[int, dict], max_items: int = 4000) -> list[dict]:
    """
    輸出給前端的元件清單（供互動式擦除 UI 使用）。
    noise 不輸出；其餘全部輸出（含一般 ink，讓使用者可以點擊任意筆畫強制擦除）。
    超過 max_items 時優先保留：removed/forced/restored > candidate > ink（按面積大到小）。
    """
    rank = {'removed': 0, 'forced': 0, 'restored': 0, 'candidate': 1, 'ink': 2}
    items = [
        {
            'id': label,
            'x': d['bbox'][0],
            'y': d['bbox'][1],
            'w': d['bbox'][2],
            'h': d['bbox'][3],
            'erased': d['erased'],
            'kind': d['kind'],
        }
        for label, d in decisions.items()
        if d['kind'] != 'noise' and d['area'] >= 15
    ]
    items.sort(key=lambda it: (rank.get(it['kind'], 3), -(it['w'] * it['h'])))
    return items[:max_items]


def _estimate_skew_angle(binary: np.ndarray) -> float:
    coords = np.column_stack(np.where(binary < 250))
    if len(coords) < 500:
        return 0.0

    angle = cv2.minAreaRect(coords)[-1]
    angle = -(90 + angle) if angle < -45 else -angle
    return 0.0 if abs(angle) < 0.3 else angle


def _rotate_image(image: np.ndarray, angle: float) -> np.ndarray:
    if abs(angle) < 0.3:
        return image

    height, width = image.shape[:2]
    center = (width // 2, height // 2)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    return cv2.warpAffine(image, matrix, (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def _smart_enhance(image: np.ndarray, binary: np.ndarray, chart_mask: np.ndarray | None = None, darkness: float = 1.0) -> np.ndarray:
    """
    v11: 智慧雙向強化 + 對比拉伸 + 可調黑度

    細小符號 rescue 與圖表保護已移到 _classify_components（保留的元件
    直接留在 binary 裡），這裡只負責：
    - 印刷字區域：對比拉伸 + gamma → 又黑又銳利、無光暈
    - 非印刷區域：grayfilter 清除淡灰殘留
    - darkness: 0.5（較淡）~ 2.0（最深），預設 1.0
    """
    result = image.astype(np.float32)
    # 黑度範圍 clamp
    darkness = max(0.5, min(2.0, darkness))

    # 保留下來的墨水（印刷字 + 被救回/保護的元件）
    is_printed_strong = binary < 128

    # 印刷字保護 mask（5x5 dilate）
    printed_dilated = cv2.dilate(
        (is_printed_strong * 255).astype(np.uint8),
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)),
        iterations=1,
    ) > 0

    # 4. 印刷字加深：對比拉伸 + gamma + darkness 倍數
    # 基礎處理（v9 預設）
    stretched = np.clip((result - 50) * 200.0 / 130.0, 0, 200)
    normalized = stretched / 255.0
    gamma_corrected = np.power(np.clip(normalized, 0, 1), 0.7) * 255.0
    base_darkened = np.where(result < 220, gamma_corrected, result)

    # darkness 倍數：直接對暗像素做乘法縮放
    # darkness=1.0 → 維持 v9 預設
    # darkness=2.0 → 印刷字超深、極黑
    # darkness=0.5 → 印刷字稍淡（不會消失）
    if darkness != 1.0:
        darkness_amount = 255.0 - base_darkened
        # 0.5→0.6, 1.0→1.0, 1.5→2.2, 2.0→3.4
        scale = 1.0 + (darkness - 1.0) * 2.4
        new_darkness = darkness_amount * scale
        base_darkened = np.clip(255.0 - new_darkness, 0, 255)

    result_print = np.where(printed_dilated, base_darkened, result)

    # 5. 非印刷區清淡灰
    avg_5x5 = cv2.boxFilter(result_print, ddepth=-1, ksize=(5, 5))
    min_5x5 = cv2.erode(
        result_print.astype(np.uint8),
        np.ones((5, 5), np.uint8),
    ).astype(np.float32)

    is_residue = (
        ~printed_dilated
        & (avg_5x5 > 210)
        & (avg_5x5 < 248)
        & (min_5x5 > 130)
    )

    # ★ v10: 圖表區永遠不算淡灰殘留
    if chart_mask is not None:
        is_residue = is_residue & ~chart_mask

    return np.clip(np.where(is_residue, 255, result_print), 0, 255).astype(np.uint8)


def _build_soft_clean_image(gray: np.ndarray, binary: np.ndarray, chart_mask: np.ndarray | None = None, darkness: float = 1.0, removed_mask: np.ndarray | None = None) -> np.ndarray:
    """
    v11: 智慧雙向強化 + 可調黑度 + 被擦除元件強制洗白

    ★ v11 關鍵修正：舊版只靠淡灰殘留濾鏡（210~248）清除手寫，
    深色筆跡（黑筆、重壓鉛筆）在灰階合成圖上會留下明顯灰影。
    現在直接把被擦除元件的像素（含 5px 暈染範圍）設成白色，
    再用 ~ink mask 保護緊鄰的印刷筆畫不被誤洗。
    """
    white_lifted = cv2.normalize(gray, None, 40, 255, cv2.NORM_MINMAX)
    white_canvas = np.full_like(white_lifted, 255)
    base = cv2.addWeighted(white_lifted, 0.72, white_canvas, 0.28, 0)

    if removed_mask is not None and removed_mask.any():
        whiten = cv2.dilate(
            removed_mask.astype(np.uint8) * 255,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)),
            iterations=1,
        ) > 0
        # 不洗到保留下來的墨水（緊鄰的印刷筆畫）
        whiten &= ~(binary < 128)
        base[whiten] = 255

    return _smart_enhance(base, binary, chart_mask, darkness)


def _build_ocr_clean_image(gray: np.ndarray, binary: np.ndarray) -> np.ndarray:
    white_canvas = np.full_like(gray, 255)
    text_mask = cv2.bitwise_not(binary)
    text_mask = cv2.dilate(text_mask, cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2)), iterations=1)

    # 過濾條件不能太兇：小數點 ~9px、等號橫槓 aspect ~8-10，
    # 砍掉會讓數學題無法判讀（v11.1 從 area<18 / aspect 12 放寬）
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(text_mask, connectivity=8)
    for label in range(1, num_labels):
        area = stats[label, cv2.CC_STAT_AREA]
        width = stats[label, cv2.CC_STAT_WIDTH]
        height = max(stats[label, cv2.CC_STAT_HEIGHT], 1)
        aspect = width / height
        if area < 6 or aspect > 25 or aspect < 0.04:
            text_mask[labels == label] = 0

    base = cv2.normalize(gray, None, 0, 255, cv2.NORM_MINMAX)
    boosted = cv2.addWeighted(base, 1.45, cv2.GaussianBlur(base, (0, 0), 1.4), -0.45, 0)

    output = white_canvas.copy()
    output[text_mask > 0] = boosted[text_mask > 0]
    output = cv2.normalize(output, None, 0, 255, cv2.NORM_MINMAX)
    _, output = cv2.threshold(output, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return output


def _write_png(output_path: Path, image: np.ndarray) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    success, encoded = cv2.imencode('.png', image)
    if not success:
        raise ValueError('無法輸出去痕跡圖片')
    output_path.write_bytes(encoded.tobytes())
    return output_path


def cleanup_exam_image_opencv(
    input_path: Path,
    output_path: Path,
    ocr_output_path: Path | None = None,
    darkness: float = 1.0,
    keep_ids: list[int] | None = None,
    erase_ids: list[int] | None = None,
    collect_components: bool = False,
    sample_points: list[tuple[float, float]] | None = None,
) -> CleanupArtifacts:
    """
    v11 pipeline：元件分類 → 擦除 mask → 洗白合成

    keep_ids / erase_ids 是使用者在互動式擦除 UI 的覆寫；
    元件 id = connectedComponentsWithStats 的 label index，
    同一張圖（同尺寸）重跑結果 deterministic，id 跨請求穩定。
    """
    image = _load_image(input_path)
    image = _resize_if_needed(image)
    image = _remove_colored_marks(image)

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    enhanced = _normalize_document_background(gray)
    original_binary = _binarize_document(enhanced)
    chart_mask = _detect_chart_regions(original_binary)

    cc = cv2.connectedComponentsWithStats(255 - original_binary, connectivity=8)
    decisions, sample_info = _classify_components(
        enhanced, original_binary, chart_mask, cc,
        keep_set=set(keep_ids or []),
        erase_set=set(erase_ids or []),
        color_image=image,
        sample_points=sample_points,
    )

    labels = cc[1]
    removed_mask = _build_removed_mask(labels, decisions)
    binary = original_binary.copy()
    binary[removed_mask] = 255

    output = _build_soft_clean_image(enhanced, binary, chart_mask, darkness, removed_mask)
    ocr_output = _build_ocr_clean_image(enhanced, binary)

    _write_png(output_path, output)
    final_ocr_path = None
    if ocr_output_path is not None:
        final_ocr_path = _write_png(ocr_output_path, ocr_output)

    h, w = output.shape[:2]
    return CleanupArtifacts(
        processor='opencv',
        cleaned_path=output_path,
        ocr_path=final_ocr_path,
        components=_components_payload(decisions) if collect_components else None,
        image_width=w,
        image_height=h,
        sample_result=sample_info,
    )


def has_unpaper() -> bool:
    return shutil.which('unpaper') is not None


def cleanup_exam_image_unpaper(input_path: Path, output_path: Path, ocr_output_path: Path | None = None) -> CleanupArtifacts:
    unpaper = shutil.which('unpaper')
    if not unpaper:
        raise RuntimeError('目前環境未安裝 unpaper，請先安裝後再使用此模式')

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir)
        source = tmp / 'input.png'
        normalized = tmp / 'normalized.png'
        source.write_bytes(input_path.read_bytes())

        image = _load_image(source)
        image = _resize_if_needed(image)
        image = _remove_colored_marks(image)
        success, encoded = cv2.imencode('.png', image)
        if not success:
            raise ValueError('無法準備 unpaper 輸入圖片')
        normalized.write_bytes(encoded.tobytes())

        command = [
            unpaper,
            '--overwrite',
            '--no-blackfilter',
            '--noisefilter-intensity', '4',
            '--grayfilter-size', '5',
            '--layout', 'single',
            str(normalized),
            str(output_path),
        ]
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            stderr = result.stderr.strip() or result.stdout.strip() or 'unpaper 執行失敗'
            raise RuntimeError(stderr)

    final_ocr_path = None
    if ocr_output_path is not None:
        shutil.copyfile(output_path, ocr_output_path)
        final_ocr_path = ocr_output_path

    return CleanupArtifacts(processor='unpaper', cleaned_path=output_path, ocr_path=final_ocr_path)


def cleanup_exam_image(
    input_path: Path,
    output_path: Path,
    mode: CleanupMode = 'auto',
    ocr_output_path: Path | None = None,
    darkness: float = 1.0,
    keep_ids: list[int] | None = None,
    erase_ids: list[int] | None = None,
    collect_components: bool = False,
    sample_points: list[tuple[float, float]] | None = None,
) -> CleanupArtifacts:
    if mode == 'ai':
        from .ai_cleanup_erasenet import has_ai_cleanup, cleanup_exam_image_ai
        if not has_ai_cleanup():
            raise RuntimeError('AI 清理引擎不可用（需要 PyTorch + 模型權重）')
        cleaned = cleanup_exam_image_ai(input_path, output_path)
        return CleanupArtifacts(processor='ai', cleaned_path=cleaned, ocr_path=None)

    if mode == 'unpaper':
        return cleanup_exam_image_unpaper(input_path, output_path, ocr_output_path)

    # 有元件覆寫或需要元件清單時，一律走 OpenCV（unpaper 不支援）
    needs_components = collect_components or keep_ids or erase_ids or sample_points
    if mode == 'auto' and has_unpaper() and not needs_components:
        try:
            return cleanup_exam_image_unpaper(input_path, output_path, ocr_output_path)
        except Exception:
            pass

    return cleanup_exam_image_opencv(
        input_path, output_path, ocr_output_path, darkness,
        keep_ids=keep_ids, erase_ids=erase_ids, collect_components=collect_components,
        sample_points=sample_points,
    )
