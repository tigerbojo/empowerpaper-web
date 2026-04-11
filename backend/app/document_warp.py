"""
文件透視校正（deskew）
- detect_document_corners: 自動偵測文件四邊形
- warp_document: 根據 4 個角點做透視變換拉平
"""

from pathlib import Path
from typing import List, Tuple

import cv2
import numpy as np


def _load_image(path: Path) -> np.ndarray:
    data = np.frombuffer(path.read_bytes(), dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError('無法讀取圖片')
    return img


def _write_image(path: Path, img: np.ndarray) -> None:
    success, encoded = cv2.imencode('.png', img)
    if not success:
        raise ValueError('無法輸出圖片')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encoded.tobytes())


def _order_corners(pts: np.ndarray) -> np.ndarray:
    """
    將 4 個點排序為：左上、右上、右下、左下
    pts: shape (4, 2)
    """
    rect = np.zeros((4, 2), dtype='float32')
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]  # 左上：x+y 最小
    rect[2] = pts[np.argmax(s)]  # 右下：x+y 最大

    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]  # 右上：x-y 最大（diff 最小）
    rect[3] = pts[np.argmax(diff)]  # 左下：x-y 最小（diff 最大）
    return rect


def detect_document_corners(image_path: Path) -> List[Tuple[float, float]]:
    """
    自動偵測文件四邊形角點
    回傳 4 個點（左上、右上、右下、左下）的原圖座標
    偵測失敗時回傳整張圖的 4 個角
    """
    img = _load_image(image_path)
    h, w = img.shape[:2]

    # 縮小加速處理
    max_dim = 800
    scale = min(1.0, max_dim / max(h, w))
    if scale < 1.0:
        small = cv2.resize(img, (int(w * scale), int(h * scale)))
    else:
        small = img

    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    # 雙邊濾波降噪但保留邊緣
    blurred = cv2.bilateralFilter(gray, 9, 75, 75)
    # Canny 邊緣
    edges = cv2.Canny(blurred, 30, 150)
    # 膨脹讓邊緣更連續
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    edges = cv2.dilate(edges, kernel, iterations=2)

    # 找輪廓
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:10]

    # 找出最大的四邊形
    doc_contour = None
    small_h, small_w = small.shape[:2]
    total_area = small_h * small_w

    for contour in contours:
        area = cv2.contourArea(contour)
        # 面積至少佔 20%（避免抓到小物件）
        if area < total_area * 0.2:
            continue
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        if len(approx) == 4:
            doc_contour = approx
            break

    if doc_contour is None:
        # 偵測失敗：回傳整張圖的四個角
        return [(0, 0), (w, 0), (w, h), (0, h)]

    # 還原到原圖座標
    pts = doc_contour.reshape(4, 2).astype('float32') / scale
    ordered = _order_corners(pts)

    return [(float(p[0]), float(p[1])) for p in ordered]


def warp_document(
    image_path: Path,
    corners: List[Tuple[float, float]],
    output_path: Path,
) -> Path:
    """
    根據 4 個角點做透視變換，輸出拉平後的矩形文件

    corners: 4 個 (x, y) 點，順序為 左上、右上、右下、左下
    """
    img = _load_image(image_path)

    pts = np.array(corners, dtype='float32')
    if pts.shape != (4, 2):
        raise ValueError('corners 必須是 4 個點')

    # 確保順序正確
    pts = _order_corners(pts)

    # 計算目標尺寸：用對角線距離估算
    tl, tr, br, bl = pts
    width_top = np.linalg.norm(tr - tl)
    width_bot = np.linalg.norm(br - bl)
    width = int(max(width_top, width_bot))

    height_left = np.linalg.norm(bl - tl)
    height_right = np.linalg.norm(br - tr)
    height = int(max(height_left, height_right))

    if width < 10 or height < 10:
        raise ValueError('目標尺寸太小，角點設定可能有誤')

    # 目標四邊形（正矩形）
    dst = np.array([
        [0, 0],
        [width - 1, 0],
        [width - 1, height - 1],
        [0, height - 1],
    ], dtype='float32')

    # 透視變換
    M = cv2.getPerspectiveTransform(pts, dst)
    warped = cv2.warpPerspective(img, M, (width, height), flags=cv2.INTER_LINEAR)

    _write_image(output_path, warped)
    return output_path
