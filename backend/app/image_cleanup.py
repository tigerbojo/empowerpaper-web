from pathlib import Path

import cv2
import numpy as np


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


def _deskew(binary: np.ndarray) -> np.ndarray:
    coords = np.column_stack(np.where(binary < 250))
    if len(coords) < 500:
        return binary

    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle

    if abs(angle) < 0.3:
        return binary

    height, width = binary.shape[:2]
    center = (width // 2, height // 2)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    return cv2.warpAffine(binary, matrix, (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def cleanup_exam_image(input_path: Path, output_path: Path) -> Path:
    image = _load_image(input_path)
    image = _resize_if_needed(image)

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.fastNlMeansDenoising(gray, None, 12, 7, 21)

    background = cv2.GaussianBlur(gray, (0, 0), sigmaX=21, sigmaY=21)
    normalized = cv2.divide(gray, background, scale=255)

    clahe = cv2.createCLAHE(clipLimit=2.4, tileGridSize=(8, 8))
    enhanced = clahe.apply(normalized)

    thresholded = cv2.adaptiveThreshold(
        enhanced,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        15,
    )

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    cleaned = cv2.morphologyEx(thresholded, cv2.MORPH_OPEN, kernel, iterations=1)
    cleaned = _deskew(cleaned)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    success, encoded = cv2.imencode('.png', cleaned)
    if not success:
        raise ValueError('無法輸出去痕跡圖片')
    output_path.write_bytes(encoded.tobytes())
    return output_path
