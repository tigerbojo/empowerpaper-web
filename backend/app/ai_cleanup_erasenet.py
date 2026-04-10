"""
EraseNet AI 清理引擎（替換 ViTEraser）
Fine-tuned on SCUT-EnsExam，專門處理考卷手寫筆跡消除
"""

import logging
from pathlib import Path

from PIL import Image

logger = logging.getLogger(__name__)

_MODEL_DIR = Path(__file__).resolve().parent.parent.parent / "research" / "erasenet_test"
_WEIGHTS_PATH = _MODEL_DIR / "finetune_output" / "STE_40.pth"
_REPO_DIR = _MODEL_DIR / "repo"

_model = None
_device = None
_available = None


def has_ai_cleanup() -> bool:
    global _available
    if _available is not None:
        return _available
    try:
        import torch
        _available = _WEIGHTS_PATH.exists() and _REPO_DIR.exists()
        if not _available:
            logger.warning("EraseNet: weights or repo not found at %s", _WEIGHTS_PATH)
    except ImportError:
        _available = False
    return _available


def _load_model():
    global _model, _device

    if _model is not None:
        return _model, _device

    import sys
    import torch

    repo_str = str(_REPO_DIR)
    if repo_str not in sys.path:
        sys.path.insert(0, repo_str)

    from models.sa_gan import STRnet2

    _device = "cuda" if torch.cuda.is_available() else "cpu"
    model = STRnet2(3)
    model.load_state_dict(torch.load(str(_WEIGHTS_PATH), map_location="cpu"))
    model = model.to(_device)
    model.eval()
    _model = model

    logger.info("EraseNet loaded on %s", _device)
    return _model, _device


def _infer_tile(model, tile_tensor, device):
    """單張 512x512 tile 推理"""
    import torch
    with torch.no_grad():
        _, _, _, output, _ = model(tile_tensor.unsqueeze(0).to(device))
    return torch.clamp(output, 0, 1).squeeze(0).cpu()


def cleanup_exam_image_ai(input_path: Path, output_path: Path,
                          tile_size: int = 512, overlap: int = 64) -> Path:
    """
    Tile-based EraseNet + OpenCV Hybrid 推理。
    1. 切成重疊 512x512 tiles → EraseNet 逐塊處理 → 拼回
    2. OpenCV 跑一次取得乾淨底圖
    3. 用 AI 差異偵測手寫區域，在 OpenCV 底圖上混合 AI 結果
    """
    import torch
    import torchvision.transforms as transforms
    import numpy as np
    import cv2

    model, device = _load_model()
    to_tensor = transforms.ToTensor()
    to_pil = transforms.ToPILImage()

    img = Image.open(input_path).convert("RGB")
    orig_w, orig_h = img.size

    # 工作大小：最長邊 2048px
    scale = min(1.0, 2048 / max(orig_w, orig_h))
    work_w, work_h = int(orig_w * scale), int(orig_h * scale)
    work_img = img.resize((work_w, work_h), Image.LANCZOS)

    step = tile_size - overlap

    # 如果圖小於 tile，直接跑
    if work_w <= tile_size and work_h <= tile_size:
        padded = Image.new("RGB", (tile_size, tile_size), (255, 255, 255))
        padded.paste(work_img, (0, 0))
        out = _infer_tile(model, to_tensor(padded), device)
        result = to_pil(out).crop((0, 0, work_w, work_h))
        if scale < 1.0:
            result = result.resize((orig_w, orig_h), Image.LANCZOS)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        result.save(output_path, format="PNG")
        return output_path

    cols = max(1, (work_w - overlap + step - 1) // step)
    rows = max(1, (work_h - overlap + step - 1) // step)

    result_arr = np.zeros((3, work_h, work_w), dtype=np.float32)
    weight_arr = np.zeros((1, work_h, work_w), dtype=np.float32)

    # Blending 權重
    blend_w = np.ones((tile_size, tile_size), dtype=np.float32)
    if overlap > 0:
        ramp = np.linspace(0, 1, overlap)
        for i in range(overlap):
            blend_w[i, :] *= ramp[i]
            blend_w[-(i + 1), :] *= ramp[i]
            blend_w[:, i] *= ramp[i]
            blend_w[:, -(i + 1)] *= ramp[i]

    for row in range(rows):
        for col in range(cols):
            x = min(col * step, max(0, work_w - tile_size))
            y = min(row * step, max(0, work_h - tile_size))

            tile = work_img.crop((x, y, x + tile_size, y + tile_size))
            tw, th = tile.size
            if tw < tile_size or th < tile_size:
                padded = Image.new("RGB", (tile_size, tile_size), (255, 255, 255))
                padded.paste(tile, (0, 0))
                tile = padded

            out_tensor = _infer_tile(model, to_tensor(tile), device)
            out_np = out_tensor.numpy()

            ah = min(tile_size, work_h - y)
            aw = min(tile_size, work_w - x)
            result_arr[:, y:y+ah, x:x+aw] += out_np[:, :ah, :aw] * blend_w[:ah, :aw]
            weight_arr[:, y:y+ah, x:x+aw] += blend_w[:ah, :aw]

    weight_arr = np.maximum(weight_arr, 1e-6)
    result_arr = np.clip(result_arr / weight_arr, 0, 1)

    ai_result = to_pil(torch.from_numpy(result_arr))
    if scale < 1.0:
        ai_result = ai_result.resize((orig_w, orig_h), Image.LANCZOS)

    # === Hybrid: OpenCV 底圖 + AI 手寫區域混合 ===
    from .image_cleanup import cleanup_exam_image_opencv

    opencv_path = output_path.parent / f"{output_path.stem}_cv_base.png"
    cleanup_exam_image_opencv(input_path, opencv_path)

    opencv_img = cv2.imdecode(np.frombuffer(opencv_path.read_bytes(), np.uint8), cv2.IMREAD_COLOR)
    ai_img = cv2.cvtColor(np.array(ai_result), cv2.COLOR_RGB2BGR)

    if opencv_img.shape[:2] != ai_img.shape[:2]:
        ai_img = cv2.resize(ai_img, (opencv_img.shape[1], opencv_img.shape[0]))

    # 原圖
    orig_img = cv2.imdecode(np.frombuffer(input_path.read_bytes(), np.uint8), cv2.IMREAD_COLOR)
    if orig_img.shape[:2] != opencv_img.shape[:2]:
        orig_img = cv2.resize(orig_img, (opencv_img.shape[1], opencv_img.shape[0]))

    # 漸層 confidence: AI 擦掉越多 → 越用 AI 結果
    orig_gray = cv2.cvtColor(orig_img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    ai_gray = cv2.cvtColor(ai_img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    opencv_gray = cv2.cvtColor(opencv_img, cv2.COLOR_BGR2GRAY).astype(np.float32)

    ai_diff = np.clip(ai_gray - orig_gray, 0, None)
    confidence = np.clip((ai_diff - 20) / 60.0, 0, 1)

    # 彩色筆跡 boost
    orig_hsv = cv2.cvtColor(orig_img, cv2.COLOR_BGR2HSV)
    color_boost = np.clip(orig_hsv[:, :, 1].astype(np.float32) / 80.0, 0, 1) * 0.3

    # 印刷字保護
    opencv_hsv = cv2.cvtColor(opencv_img, cv2.COLOR_BGR2HSV)
    is_printed = ((opencv_gray < 160) & (opencv_hsv[:, :, 1].astype(np.float32) < 40)).astype(np.float32)
    protection = is_printed * 0.7

    confidence = np.clip(confidence + color_boost - protection, 0, 1)
    confidence = cv2.GaussianBlur(confidence, (7, 7), 2.0)

    mask_3ch = np.stack([confidence] * 3, axis=-1)
    result = (mask_3ch * ai_img + (1 - mask_3ch) * opencv_img).astype(np.uint8)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imencode('.png', result)[1].tofile(str(output_path))

    opencv_path.unlink(missing_ok=True)
    logger.info("EraseNet hybrid tile cleanup done → %s", output_path.name)
    return output_path
