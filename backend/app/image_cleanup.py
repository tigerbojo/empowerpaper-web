import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .schemas import CleanupMode, CleanupProcessor


@dataclass
class CleanupArtifacts:
    processor: CleanupProcessor
    cleaned_path: Path
    ocr_path: Path | None = None


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
    binary = cv2.bitwise_or(adaptive, otsu)

    open_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, open_kernel, iterations=1)

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(255 - binary, connectivity=8)
    cleaned = binary.copy()
    for label in range(1, num_labels):
        if stats[label, cv2.CC_STAT_AREA] < 15:
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


def _remove_gray_marks(enhanced: np.ndarray, binary: np.ndarray, chart_mask: np.ndarray) -> np.ndarray:
    """
    v4: 圖表保護 + 雙向投影 + 局部密度 + 形狀特徵投票

    核心策略：
    - 圖表/表格/幾何圖區域內的元件直接保留，不參與手寫判定（v4 新增）
    - 印刷字會排在規律的水平行/垂直列上 → 兩個方向同時偏離 = 手寫
    - 印刷字密集分布 → 周圍密度低 = 孤立筆跡 = 手寫
    - 配合形狀特徵（密度、長寬比、面積）做投票
    """
    h_img, w_img = binary.shape

    # 雙向投影
    h_in_line, v_in_line = _detect_text_grid(binary)

    # 局部密度地圖（大 kernel 平滑後的文字密度）
    text_inv_norm = (255 - binary).astype(np.float32) / 255.0
    density_map = cv2.GaussianBlur(text_inv_norm, (51, 51), 15)

    text_inv = 255 - binary
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(text_inv, connectivity=8)
    cleaned = binary.copy()

    for label in range(1, num_labels):
        x = stats[label, cv2.CC_STAT_LEFT]
        y = stats[label, cv2.CC_STAT_TOP]
        cw = stats[label, cv2.CC_STAT_WIDTH]
        ch = stats[label, cv2.CC_STAT_HEIGHT]
        area = stats[label, cv2.CC_STAT_AREA]

        # 小雜點直接清除
        if area < 8:
            cleaned[labels == label] = 255
            continue

        # ★ v4 圖表保護：中心點落在圖表區 → 直接保留
        cy_chk = min(y + ch // 2, h_img - 1)
        cx_chk = min(x + cw // 2, w_img - 1)
        if chart_mask[cy_chk, cx_chk]:
            continue

        # 行列對齊度
        ys = list(range(y, min(y + ch, h_img)))
        xs = list(range(x, min(x + cw, w_img)))
        h_ratio = float(np.mean(h_in_line[ys])) if ys else 0.0
        v_ratio = float(np.mean(v_in_line[xs])) if xs else 0.0
        is_off_grid = h_ratio < 0.5 and v_ratio < 0.5

        # 局部密度（中心點周圍）
        cy = y + ch // 2
        cx = x + cw // 2
        local_density = float(density_map[min(cy, h_img - 1), min(cx, w_img - 1)])
        is_isolated = local_density < 0.05

        # 形狀特徵
        bbox_area = max(cw * ch, 1)
        density = area / bbox_area
        aspect = cw / max(ch, 1)

        # 投票（偏離行列 + 孤立 = 強信號，各 2 票）
        votes = 0
        if is_off_grid:
            votes += 2
        if is_isolated:
            votes += 2
        if density < 0.2:
            votes += 1
        if aspect > 5 or aspect < 0.2:
            votes += 1
        if area > 4000:
            votes += 1

        # 至少 2 票才判定為手寫
        if votes >= 2:
            cleaned[labels == label] = 255

    return cleaned


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


def _smart_enhance(image: np.ndarray, binary: np.ndarray, original_binary: np.ndarray, chart_mask: np.ndarray | None = None, darkness: float = 1.0) -> np.ndarray:
    """
    v10: 智慧雙向強化 + 細小符號保護 + 圖表保護 + 對比拉伸 + 可調黑度

    - 印刷字區域：對比拉伸 + gamma → 又黑又銳利、無光暈
    - 細小符號（√、(A)、分數線、括號）：從原始 binary 救回保護
    - 圖表/表格/幾何圖區域：強制視為印刷區（v10 新增），避免淡灰殘留清除誤殺
    - 非印刷區域：grayfilter 清除淡灰殘留
    - darkness: 0.5（較淡）~ 2.0（最深），預設 1.0
    """
    result = image.astype(np.float32)
    # 黑度範圍 clamp
    darkness = max(0.5, min(2.0, darkness))

    # 1. v3 留下的印刷字
    is_printed = binary < 128

    # 2. 救回細小符號 + 細長形（涵蓋括號、底線、上下標）
    text_inv = 255 - original_binary
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(text_inv, connectivity=8)
    rescued = np.zeros_like(original_binary, dtype=bool)
    for label in range(1, num_labels):
        cw = stats[label, cv2.CC_STAT_WIDTH]
        ch = stats[label, cv2.CC_STAT_HEIGHT]
        area = stats[label, cv2.CC_STAT_AREA]
        bbox_area = max(cw * ch, 1)
        density = area / bbox_area
        aspect = cw / max(ch, 1)

        # 細小且形狀規則
        is_tiny_symbol = 8 < area < 250 and density > 0.25 and 0.2 < aspect < 5.0

        # 細長形（括號、底線、分數線）
        is_thin_shape = (
            8 < area < 400
            and (
                (aspect > 0.15 and aspect < 0.5 and ch < 40)
                or (aspect > 2.0 and aspect < 8.0 and cw < 60)
            )
        )

        if is_tiny_symbol or is_thin_shape:
            rescued |= (labels == label)

    is_printed_strong = is_printed | rescued

    # ★ v10: 圖表區內的所有原始筆畫都視為印刷區（保護座標軸、表格線、幾何圖）
    if chart_mask is not None:
        original_ink = original_binary < 128
        is_printed_strong = is_printed_strong | (chart_mask & original_ink)

    # 3. 印刷字保護 mask（5x5 dilate）
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


def _build_soft_clean_image(gray: np.ndarray, binary: np.ndarray, original_binary: np.ndarray | None = None, chart_mask: np.ndarray | None = None, darkness: float = 1.0) -> np.ndarray:
    """v10: 智慧雙向強化 + 細小符號保護 + 圖表保護 + 可調黑度"""
    white_lifted = cv2.normalize(gray, None, 40, 255, cv2.NORM_MINMAX)
    white_canvas = np.full_like(white_lifted, 255)
    base = cv2.addWeighted(white_lifted, 0.72, white_canvas, 0.28, 0)

    if original_binary is None:
        original_binary = binary

    return _smart_enhance(base, binary, original_binary, chart_mask, darkness)


def _build_ocr_clean_image(gray: np.ndarray, binary: np.ndarray) -> np.ndarray:
    white_canvas = np.full_like(gray, 255)
    text_mask = cv2.bitwise_not(binary)
    text_mask = cv2.dilate(text_mask, cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2)), iterations=1)

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(text_mask, connectivity=8)
    for label in range(1, num_labels):
        area = stats[label, cv2.CC_STAT_AREA]
        width = stats[label, cv2.CC_STAT_WIDTH]
        height = max(stats[label, cv2.CC_STAT_HEIGHT], 1)
        aspect = width / height
        if area < 18 or aspect > 12 or aspect < 0.08:
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


def cleanup_exam_image_opencv(input_path: Path, output_path: Path, ocr_output_path: Path | None = None, darkness: float = 1.0) -> CleanupArtifacts:
    image = _load_image(input_path)
    image = _resize_if_needed(image)
    image = _remove_colored_marks(image)

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    enhanced = _normalize_document_background(gray)
    original_binary = _binarize_document(enhanced)
    chart_mask = _detect_chart_regions(original_binary)
    binary = _remove_gray_marks(enhanced, original_binary.copy(), chart_mask)

    output = _build_soft_clean_image(enhanced, binary, original_binary, chart_mask, darkness)
    ocr_output = _build_ocr_clean_image(enhanced, binary)

    _write_png(output_path, output)
    final_ocr_path = None
    if ocr_output_path is not None:
        final_ocr_path = _write_png(ocr_output_path, ocr_output)

    return CleanupArtifacts(processor='opencv', cleaned_path=output_path, ocr_path=final_ocr_path)


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


def cleanup_exam_image(input_path: Path, output_path: Path, mode: CleanupMode = 'auto', ocr_output_path: Path | None = None, darkness: float = 1.0) -> CleanupArtifacts:
    if mode == 'ai':
        from .ai_cleanup_erasenet import has_ai_cleanup, cleanup_exam_image_ai
        if not has_ai_cleanup():
            raise RuntimeError('AI 清理引擎不可用（需要 PyTorch + 模型權重）')
        cleaned = cleanup_exam_image_ai(input_path, output_path)
        return CleanupArtifacts(processor='ai', cleaned_path=cleaned, ocr_path=None)

    if mode == 'unpaper':
        return cleanup_exam_image_unpaper(input_path, output_path, ocr_output_path)

    if mode == 'auto' and has_unpaper():
        try:
            return cleanup_exam_image_unpaper(input_path, output_path, ocr_output_path)
        except Exception:
            pass

    return cleanup_exam_image_opencv(input_path, output_path, ocr_output_path, darkness)
