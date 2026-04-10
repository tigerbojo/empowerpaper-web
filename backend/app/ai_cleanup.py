"""
AI 去手寫清理引擎 (ViTEraser fine-tuned on SCUT-EnsExam)

Optional — 需要 PyTorch + CUDA。
如果環境沒有 torch，has_ai_cleanup() 回傳 False，主流程 fallback 到 OpenCV。
"""

import logging
from pathlib import Path

from PIL import Image

logger = logging.getLogger(__name__)

# ── 模型權重路徑 ──────────────────────────────────
# 相對於 backend/ 目錄
_MODEL_DIR = Path(__file__).resolve().parent.parent.parent / "research" / "viteraser_test"
_WEIGHTS_PATH = _MODEL_DIR / "finetune_output" / "checkpoint_epoch150.pth"
_REPO_DIR = _MODEL_DIR / "repo"

# ── Lazy-loaded 全域模型 ─────────────────────────
_model = None
_device = None
_available = None


def has_ai_cleanup() -> bool:
    """檢查 AI cleanup 是否可用（torch + 權重都在）"""
    global _available
    if _available is not None:
        return _available
    try:
        import torch  # noqa: F401
        _available = _WEIGHTS_PATH.exists() and _REPO_DIR.exists()
        if not _available:
            logger.warning("AI cleanup: weights or repo not found at %s", _WEIGHTS_PATH)
    except ImportError:
        _available = False
        logger.info("AI cleanup: PyTorch not installed, disabled")
    return _available


def _load_model():
    """Lazy load ViTEraser model（第一次呼叫時載入）"""
    global _model, _device

    if _model is not None:
        return _model, _device

    import sys
    import torch
    import torchvision.transforms as transforms  # noqa: F401

    # 把 ViTEraser repo 加入 path
    repo_str = str(_REPO_DIR)
    if repo_str not in sys.path:
        sys.path.insert(0, repo_str)

    from models.encoder import build_encoder
    from models.decoder import build_decoder
    from models.viteraser import ViTEraser
    from utils.parser import get_args_parser

    # 建構 ViTEraser-Tiny
    parser = get_args_parser()
    args = parser.parse_args([])
    args.encoder = "swinv2"
    args.decoder = "swinv2"
    args.pred_mask = True
    args.intermediate_erase = True
    args.swin_enc_embed_dim = 96
    args.swin_enc_depths = [2, 2, 6, 2]
    args.swin_enc_num_heads = [3, 6, 12, 24]
    args.swin_enc_window_size = 16
    args.swin_dec_depths = [2, 6, 2, 2, 2]
    args.swin_dec_num_heads = [24, 12, 6, 3, 2]
    args.swin_dec_window_size = 16
    args.lr_encoder_ratio = 0.05
    args.eval = True

    _device = "cuda" if torch.cuda.is_available() else "cpu"
    args.device = _device

    encoder = build_encoder(args)
    decoder = build_decoder(args)
    model = ViTEraser(encoder=encoder, decoder=decoder, vgg16=None)

    # 載入 fine-tuned 權重
    checkpoint = torch.load(str(_WEIGHTS_PATH), map_location="cpu")
    state_dict = checkpoint.get("model", checkpoint)
    cleaned = {k.replace("module.", ""): v for k, v in state_dict.items()}
    model_dict = model.state_dict()
    loaded = {k: v for k, v in cleaned.items()
              if k in model_dict and v.shape == model_dict[k].shape}
    model_dict.update(loaded)
    model.load_state_dict(model_dict, strict=False)

    model = model.to(_device)
    model.eval()
    _model = model

    logger.info("AI cleanup model loaded: %d/%d keys, device=%s", len(loaded), len(model_dict), _device)
    return _model, _device


def _infer_single(model, tensor, device):
    """單張 512x512 tensor 推理"""
    import torch
    with torch.no_grad():
        outputs = model(tensor.unsqueeze(0).to(device))
        output = outputs[-1] if isinstance(outputs, (list, tuple)) else outputs
    return torch.clamp(output, 0, 1).squeeze(0).cpu()


def cleanup_exam_image_ai(input_path: Path, output_path: Path, tile_size: int = 512, overlap: int = 64) -> Path:
    """
    Tile-based ViTEraser 推理。
    把大圖切成重疊的 512x512 小塊分別處理，再用 blending 拼回原始大小。
    比起整張 resize 到 512x512，細節保留大幅提升。
    """
    import torch
    import torchvision.transforms as transforms
    import numpy as np

    model, device = _load_model()
    to_tensor = transforms.ToTensor()
    to_pil = transforms.ToPILImage()

    img = Image.open(input_path).convert("RGB")
    orig_w, orig_h = img.size

    # 如果圖片小於等於 tile_size，直接整張跑
    if orig_w <= tile_size and orig_h <= tile_size:
        img_resized = img.resize((tile_size, tile_size), Image.LANCZOS)
        result_tensor = _infer_single(model, to_tensor(img_resized), device)
        result = to_pil(result_tensor).resize((orig_w, orig_h), Image.LANCZOS)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        result.save(output_path, format="PNG")
        return output_path

    # 計算 tile 網格（帶重疊）
    step = tile_size - overlap
    # 先將圖片 resize 到合理的工作大小（最長邊 2048px 以內）
    scale = min(1.0, 2048 / max(orig_w, orig_h))
    work_w, work_h = int(orig_w * scale), int(orig_h * scale)
    work_img = img.resize((work_w, work_h), Image.LANCZOS)

    # 計算需要多少 tiles
    cols = max(1, (work_w - overlap + step - 1) // step)
    rows = max(1, (work_h - overlap + step - 1) // step)

    # 結果 canvas + 權重 canvas（用於 blending）
    result_arr = np.zeros((3, work_h, work_w), dtype=np.float32)
    weight_arr = np.zeros((1, work_h, work_w), dtype=np.float32)

    # 生成 blending 權重（中心權重高，邊緣低）
    blend_w = np.ones((tile_size, tile_size), dtype=np.float32)
    if overlap > 0:
        ramp = np.linspace(0, 1, overlap)
        # 四邊漸變
        for i in range(overlap):
            blend_w[i, :] *= ramp[i]
            blend_w[-(i + 1), :] *= ramp[i]
            blend_w[:, i] *= ramp[i]
            blend_w[:, -(i + 1)] *= ramp[i]

    total_tiles = rows * cols
    logger.info("Tile inference: %dx%d grid (%d tiles), work size %dx%d", cols, rows, total_tiles, work_w, work_h)

    for row in range(rows):
        for col in range(cols):
            # tile 左上角座標
            x = min(col * step, work_w - tile_size)
            y = min(row * step, work_h - tile_size)
            x = max(0, x)
            y = max(0, y)

            # 裁切 tile
            tile = work_img.crop((x, y, x + tile_size, y + tile_size))

            # 如果 tile 不足 512x512（邊緣情況），pad 到 512
            tw, th = tile.size
            if tw < tile_size or th < tile_size:
                padded = Image.new("RGB", (tile_size, tile_size), (255, 255, 255))
                padded.paste(tile, (0, 0))
                tile = padded

            # 推理
            tile_tensor = to_tensor(tile)
            out_tensor = _infer_single(model, tile_tensor, device)
            out_np = out_tensor.numpy()  # [3, 512, 512]

            # 加權寫入結果
            actual_h = min(tile_size, work_h - y)
            actual_w = min(tile_size, work_w - x)
            result_arr[:, y:y + actual_h, x:x + actual_w] += out_np[:, :actual_h, :actual_w] * blend_w[:actual_h, :actual_w]
            weight_arr[:, y:y + actual_h, x:x + actual_w] += blend_w[:actual_h, :actual_w]

    # 歸一化
    weight_arr = np.maximum(weight_arr, 1e-6)
    result_arr /= weight_arr

    # 轉回 PIL + resize 回原始大小
    result_arr = np.clip(result_arr, 0, 1)
    result_tensor = torch.from_numpy(result_arr)
    result = to_pil(result_tensor)
    if scale < 1.0:
        result = result.resize((orig_w, orig_h), Image.LANCZOS)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    result.save(output_path, format="PNG")

    logger.info("AI cleanup done: %d tiles, output %s", total_tiles, output_path.name)
    return output_path


def cleanup_exam_image_hybrid(input_path: Path, output_path: Path) -> Path:
    """
    混合模式 v3：漸層 confidence 混合 + 色彩感知手寫偵測。

    核心改進：
    - 不再用 binary mask，改用 0~1 漸層 confidence
    - 用色彩資訊（HSV saturation）區分彩色手寫 vs 黑色印刷
    - AI 差異越大 → confidence 越高 → 越多用 AI 結果
    - 印刷字區域 → confidence 壓低 → 保留 OpenCV 的清晰度
    """
    import cv2
    import numpy as np

    # Step 1: OpenCV 清理 → 乾淨底圖
    opencv_path = output_path.parent / f"{output_path.stem}_opencv_base.png"
    from .image_cleanup import cleanup_exam_image_opencv
    cleanup_exam_image_opencv(input_path, opencv_path)
    opencv_img = cv2.imdecode(
        np.frombuffer(opencv_path.read_bytes(), dtype=np.uint8), cv2.IMREAD_COLOR,
    )

    # Step 2: AI 清理 → 去手寫結果
    ai_path = output_path.parent / f"{output_path.stem}_ai_raw.png"
    cleanup_exam_image_ai(input_path, ai_path)
    ai_img = cv2.imdecode(
        np.frombuffer(ai_path.read_bytes(), dtype=np.uint8), cv2.IMREAD_COLOR,
    )

    # 確保尺寸一致
    if opencv_img.shape[:2] != ai_img.shape[:2]:
        ai_img = cv2.resize(ai_img, (opencv_img.shape[1], opencv_img.shape[0]))

    # 讀原圖
    orig_img = cv2.imdecode(
        np.frombuffer(input_path.read_bytes(), dtype=np.uint8), cv2.IMREAD_COLOR,
    )
    if orig_img.shape[:2] != opencv_img.shape[:2]:
        orig_img = cv2.resize(orig_img, (opencv_img.shape[1], opencv_img.shape[0]))

    # ── Step 3: 建構漸層 confidence mask ──────────────

    orig_gray = cv2.cvtColor(orig_img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    ai_gray = cv2.cvtColor(ai_img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    opencv_gray = cv2.cvtColor(opencv_img, cv2.COLOR_BGR2GRAY).astype(np.float32)

    # Signal 1: AI 擦除強度（AI 比原圖亮多少 → 手寫 confidence）
    ai_diff = np.clip(ai_gray - orig_gray, 0, None)
    # 漸層：diff 20 以下 = 0，diff 80 以上 = 1，中間線性
    ai_confidence = np.clip((ai_diff - 20) / 60.0, 0, 1)

    # Signal 2: 彩色筆跡偵測（HSV saturation）
    orig_hsv = cv2.cvtColor(orig_img, cv2.COLOR_BGR2HSV)
    saturation = orig_hsv[:, :, 1].astype(np.float32)
    # 高飽和度 = 彩色筆（紅/藍）→ 更可能是手寫
    color_boost = np.clip(saturation / 80.0, 0, 1) * 0.3  # 最多加 0.3

    # Signal 3: 印刷字保護（OpenCV 底圖中深色且低飽和 = 黑色印刷字）
    # OpenCV 處理後仍然很暗的 = 印刷字 → 壓低 confidence
    opencv_hsv = cv2.cvtColor(opencv_img, cv2.COLOR_BGR2HSV)
    opencv_sat = opencv_hsv[:, :, 1].astype(np.float32)
    # 黑色印刷字：亮度低 + 飽和度低
    is_printed_black = ((opencv_gray < 160) & (opencv_sat < 40)).astype(np.float32)
    # 印刷字保護：把 confidence 壓低
    print_protection = is_printed_black * 0.7  # 最多壓掉 0.7

    # 合成最終 confidence
    confidence = np.clip(ai_confidence + color_boost - print_protection, 0, 1)

    # 高斯模糊讓 mask 邊緣柔和
    confidence = cv2.GaussianBlur(confidence, (7, 7), 2.0)

    # ── Step 4: 漸層混合 ─────────────────────────────

    mask_3ch = np.stack([confidence] * 3, axis=-1).astype(np.float32)
    result = (mask_3ch * ai_img.astype(np.float32)
              + (1 - mask_3ch) * opencv_img.astype(np.float32))
    result = np.clip(result, 0, 255).astype(np.uint8)

    # 存檔
    output_path.parent.mkdir(parents=True, exist_ok=True)
    success, encoded = cv2.imencode('.png', result)
    if success:
        output_path.write_bytes(encoded.tobytes())

    # 清理暫存檔
    opencv_path.unlink(missing_ok=True)
    ai_path.unlink(missing_ok=True)

    logger.info("Hybrid v3 cleanup done: gradient blend → %s", output_path.name)
    return output_path
