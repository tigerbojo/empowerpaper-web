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


def _remove_gray_marks(enhanced: np.ndarray, binary: np.ndarray) -> np.ndarray:
    """v2: 多重條件投票制，比單一 threshold 更精準"""
    text_inv = 255 - binary
    dist = cv2.distanceTransform(text_inv, cv2.DIST_L2, 5)

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(text_inv, connectivity=8)
    cleaned = binary.copy()

    for label in range(1, num_labels):
        mask = labels == label
        stroke_widths = dist[mask]
        if stroke_widths.size == 0:
            continue

        area = stats[label, cv2.CC_STAT_AREA]
        w = stats[label, cv2.CC_STAT_WIDTH]
        h = max(stats[label, cv2.CC_STAT_HEIGHT], 1)
        aspect = w / h
        mean_sw = float(np.mean(stroke_widths))
        std_sw = float(np.std(stroke_widths))
        sw_var = std_sw / max(mean_sw, 0.1)
        bbox_area = max(w * h, 1)
        density = area / bbox_area
        region_intensity = float(np.mean(enhanced[mask]))

        # 小雜點直接清除
        if area < 8:
            cleaned[mask] = 255
            continue

        # 多重條件投票
        votes = 0
        if sw_var > 0.55:
            votes += 1
        if area > 5000:
            votes += 1
        if aspect > 6 or aspect < 0.15:
            votes += 1
        if density < 0.25:
            votes += 1
        if region_intensity > 180:
            votes += 1

        # 至少 2 票才判定為手寫
        if votes >= 2:
            cleaned[mask] = 255

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


def _build_soft_clean_image(gray: np.ndarray, binary: np.ndarray) -> np.ndarray:
    """v2: 更白的背景 + 更銳利的文字"""
    white_lifted = cv2.normalize(gray, None, 40, 255, cv2.NORM_MINMAX)
    white_canvas = np.full_like(white_lifted, 255)
    softened = cv2.addWeighted(white_lifted, 0.72, white_canvas, 0.28, 0)

    text_mask = cv2.bitwise_not(binary)
    text_mask = cv2.dilate(text_mask, cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2)), iterations=1)

    preserved_text = cv2.addWeighted(white_lifted, 1.35, cv2.GaussianBlur(white_lifted, (0, 0), 1.0), -0.35, 0)
    output = softened.copy()
    output[text_mask > 0] = preserved_text[text_mask > 0]
    return cv2.normalize(output, None, 5, 255, cv2.NORM_MINMAX)


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


def cleanup_exam_image_opencv(input_path: Path, output_path: Path, ocr_output_path: Path | None = None) -> CleanupArtifacts:
    image = _load_image(input_path)
    image = _resize_if_needed(image)
    image = _remove_colored_marks(image)

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    enhanced = _normalize_document_background(gray)
    binary = _binarize_document(enhanced)
    binary = _remove_gray_marks(enhanced, binary)

    output = _build_soft_clean_image(enhanced, binary)
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


def cleanup_exam_image(input_path: Path, output_path: Path, mode: CleanupMode = 'auto', ocr_output_path: Path | None = None) -> CleanupArtifacts:
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

    return cleanup_exam_image_opencv(input_path, output_path, ocr_output_path)
