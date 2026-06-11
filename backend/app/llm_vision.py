"""
LLM Vision provider 抽象層
- OllamaProvider：本地 Ollama (gemma4:26b)，開發/PoC 預設
- GeminiProvider：Google Gemini API，Cloud Run production fallback
- get_provider()：依環境變數 EMPOWERPAPER_LLM_PROVIDER 自動挑選

目前能力：
- detect_questions(image_bytes) → list[QuestionBox]
  讓 vision LLM 看一張完整考卷，回傳每一題的 normalized bbox + 題號

設計重點：
- 為什麼用 normalized coords：vision LLM 對絕對像素座標不準，
  改成 0~1 的百分比讓模型只需要「相對位置」，誤差大幅下降。
- 為什麼 think:false：根據先前 PoC 紀錄，Gemma 4 thinking tokens
  會吃掉 JSON 輸出，必須關掉。
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Literal
from urllib import error as urlerr
from urllib import request as urlreq

logger = logging.getLogger(__name__)


def _extract_json(content: str) -> dict:
    """
    從 LLM 回應中萃取 JSON。
    Gemma 即使被指定 format:json 也常會包成 ```json ... ``` markdown fence，
    所以這裡要寬容處理：先試直接 parse，再試剝 fence，最後試正則撈第一個 {...}。
    """
    if not content:
        raise ValueError('空回應')

    # 1. 直接 parse
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass

    # 2. 剝掉 ```json ... ``` 或 ``` ... ```
    fenced = re.search(r'```(?:json)?\s*(.+?)\s*```', content, re.DOTALL)
    if fenced:
        try:
            return json.loads(fenced.group(1))
        except json.JSONDecodeError:
            pass

    # 3. 撈最外層 {...}
    brace = re.search(r'\{.*\}', content, re.DOTALL)
    if brace:
        try:
            return json.loads(brace.group(0))
        except json.JSONDecodeError:
            pass

    raise ValueError(f'無法解析 JSON，原始內容前 300 字：{content[:300]}')


@dataclass
class QuestionBox:
    """單一題目偵測結果（normalized 座標 0~1）"""
    q_num: str           # "1", "2(a)", "三", ...，由模型回傳的題號文字
    x: float             # 左上 x（0~1）
    y: float             # 左上 y（0~1）
    w: float             # 寬度（0~1）
    h: float             # 高度（0~1）
    confidence: float = 0.0


# ───────── Prompt ─────────

DETECT_QUESTIONS_PROMPT = """你是考卷分析助手。請仔細觀察這張考卷圖片，把上面的「每一道題目」框出來。

規則：
1. 每一題包含：題號 + 題幹 + 選項（如果有）+ 圖表（如果有）
2. 同一題的所有內容應該框成一個矩形
3. 題號可能是阿拉伯數字（1. 2.）、國字（一、二、）、或括號（(1) (2)）
4. 跨頁、子題（a)(b)(c)）視為同一題
5. 標題、說明文字、學校名稱、姓名欄不要框

請以 JSON 格式回傳，所有座標都用 0~1 的相對比例（左上為原點），不要用絕對像素：

{
  "questions": [
    {"q_num": "1", "x": 0.05, "y": 0.10, "w": 0.90, "h": 0.08},
    {"q_num": "2", "x": 0.05, "y": 0.20, "w": 0.90, "h": 0.12}
  ]
}

只回傳 JSON，不要任何其他文字。"""


DETECT_HANDWRITING_PROMPT = """你是考卷清理助手。這張考卷上有「印刷的題目內容」和「學生或老師後來手寫上去的筆跡」。

請把所有【手寫筆跡】框出來，包含：
- 鉛筆或原子筆寫的答案（字母、數字、文字）
- 計算過程、塗鴉
- 圈選記號、勾（✓）、叉（×）、刪除線、底線
- 批改的分數、評語

規則：
1. 只框手寫的部分；印刷的題目文字、選項、圖表、表格絕對不要框
2. 框要貼緊筆跡：一段連續的筆跡框成一個矩形，分散在不同位置的筆跡分開框
3. 手寫常出現在：題號旁邊的答案、選項字母上的圈選、空白處的計算、頁面邊緣、填空底線上
4. 寧可框小而準，不要框大片區域

請以 JSON 格式回傳，所有座標都用 0~1 的相對比例（左上為原點）：

{
  "regions": [
    {"x": 0.02, "y": 0.15, "w": 0.04, "h": 0.02},
    {"x": 0.55, "y": 0.31, "w": 0.06, "h": 0.025}
  ]
}

只回傳 JSON，不要任何其他文字。"""


# ───────── Ollama provider ─────────

class OllamaProvider:
    """本地 Ollama，預設 gemma4:26b"""

    def __init__(self, base_url: str = '', model: str = ''):
        self.base_url = (base_url or os.environ.get('EMPOWERPAPER_OLLAMA_URL', 'http://localhost:11434')).rstrip('/')
        self.model = model or os.environ.get('EMPOWERPAPER_OLLAMA_MODEL', 'gemma4:26b')

    def detect_questions(self, image_bytes: bytes, timeout: float = 180.0) -> list[QuestionBox]:
        b64 = base64.b64encode(image_bytes).decode('ascii')
        payload = {
            'model': self.model,
            'messages': [{
                'role': 'user',
                'content': DETECT_QUESTIONS_PROMPT,
                'images': [b64],
            }],
            'stream': False,
            'format': 'json',
            'think': False,  # 必須關掉 thinking，否則會吃掉 JSON 輸出
            'options': {
                'temperature': 0.0,
                'num_ctx': 8192,
            },
        }
        req = urlreq.Request(
            f'{self.base_url}/api/chat',
            data=json.dumps(payload).encode('utf-8'),
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        try:
            with urlreq.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode('utf-8')
        except urlerr.URLError as exc:
            raise RuntimeError(f'Ollama 連線失敗：{exc}')

        try:
            data = json.loads(raw)
            content = data['message']['content']
            parsed = _extract_json(content)
        except (KeyError, ValueError) as exc:
            raise RuntimeError(f'Ollama 回應格式異常：{exc}\n原始回應：{raw[:500]}')

        return _parse_questions(parsed)


# ───────── Gemini provider ─────────

class GeminiProvider:
    """Google Gemini 2.5 Flash via REST API（避免額外依賴）"""

    def __init__(self, api_key: str = '', model: str = ''):
        self.api_key = api_key or os.environ.get('EMPOWERPAPER_GEMINI_API_KEY', '')
        self.model = model or os.environ.get('EMPOWERPAPER_GEMINI_MODEL', 'gemini-2.5-flash')
        if not self.api_key:
            raise RuntimeError('未設定 EMPOWERPAPER_GEMINI_API_KEY')

    def detect_questions(self, image_bytes: bytes, timeout: float = 180.0) -> list[QuestionBox]:
        parsed = self._generate(DETECT_QUESTIONS_PROMPT, image_bytes, timeout)
        return _parse_questions(parsed)

    def detect_handwriting(self, image_bytes: bytes, timeout: float = 180.0) -> list[tuple[float, float, float, float]]:
        """讓 Gemini 標出手寫筆跡區域（normalized bbox）— 擦除管線的 AI 提示"""
        parsed = self._generate(DETECT_HANDWRITING_PROMPT, image_bytes, timeout)
        return _parse_regions(parsed)

    def _generate(self, prompt: str, image_bytes: bytes, timeout: float = 180.0) -> dict:
        # gemini-2.5-flash 處理一張完整考卷約 25-45 秒，timeout 預設 180s
        b64 = base64.b64encode(image_bytes).decode('ascii')
        payload = {
            'contents': [{
                'parts': [
                    {'text': prompt},
                    {'inline_data': {'mime_type': 'image/png', 'data': b64}},
                ],
            }],
            'generationConfig': {
                'temperature': 0.0,
                'response_mime_type': 'application/json',
            },
        }
        url = (
            f'https://generativelanguage.googleapis.com/v1beta/models/'
            f'{self.model}:generateContent?key={self.api_key}'
        )
        req = urlreq.Request(
            url,
            data=json.dumps(payload).encode('utf-8'),
            headers={'Content-Type': 'application/json'},
            method='POST',
        )

        # 503/429 retry：Gemini free tier 的 overload 窗口可長達 1-2 分鐘，
        # 短退避扛不住 — 拉長退避（總計約 2 分鐘）才能騎過壅塞
        backoffs = [3, 8, 15, 30, 60]
        last_exc = None
        for attempt, backoff in enumerate(backoffs):
            try:
                with urlreq.urlopen(req, timeout=timeout) as resp:
                    raw = resp.read().decode('utf-8')
                break
            except urlerr.HTTPError as exc:
                last_exc = exc
                if exc.code in (429, 500, 502, 503, 504):
                    logger.warning(f'Gemini {exc.code}, retry in {backoff}s (attempt {attempt + 1}/{len(backoffs)})')
                    import time
                    time.sleep(backoff)
                    continue
                raise RuntimeError(f'Gemini HTTP {exc.code}: {exc.reason}')
            except urlerr.URLError as exc:
                last_exc = exc
                raise RuntimeError(f'Gemini 連線失敗：{exc}')
        else:
            raise RuntimeError(f'Gemini 持續過載（已重試 {len(backoffs)} 次仍 503/429），請稍後再按一次：{last_exc}')

        try:
            data = json.loads(raw)
            content = data['candidates'][0]['content']['parts'][0]['text']
            return _extract_json(content)
        except (KeyError, IndexError, ValueError) as exc:
            raise RuntimeError(f'Gemini 回應格式異常：{exc}\n原始回應：{raw[:500]}')


# ───────── Helpers ─────────

def _parse_questions(parsed: dict) -> list[QuestionBox]:
    items = parsed.get('questions') if isinstance(parsed, dict) else None
    if not isinstance(items, list):
        raise RuntimeError(f'未找到 questions 陣列：{str(parsed)[:300]}')

    boxes: list[QuestionBox] = []
    for raw in items:
        if not isinstance(raw, dict):
            continue
        try:
            x = float(raw.get('x', 0))
            y = float(raw.get('y', 0))
            w = float(raw.get('w', 0))
            h = float(raw.get('h', 0))
        except (TypeError, ValueError):
            continue
        # 過濾不合法 bbox
        if w <= 0 or h <= 0:
            continue
        # clamp 到 [0, 1]
        x = max(0.0, min(1.0, x))
        y = max(0.0, min(1.0, y))
        w = max(0.0, min(1.0 - x, w))
        h = max(0.0, min(1.0 - y, h))
        boxes.append(QuestionBox(
            q_num=str(raw.get('q_num', '?')),
            x=x, y=y, w=w, h=h,
            confidence=float(raw.get('confidence', 0.0) or 0.0),
        ))
    return boxes


def _parse_regions(parsed: dict) -> list[tuple[float, float, float, float]]:
    """解析手寫區域回應 → [(x, y, w, h), ...] normalized"""
    items = parsed.get('regions') if isinstance(parsed, dict) else None
    if not isinstance(items, list):
        raise RuntimeError(f'未找到 regions 陣列：{str(parsed)[:300]}')

    boxes: list[tuple[float, float, float, float]] = []
    for raw in items:
        if not isinstance(raw, dict):
            continue
        try:
            x = float(raw.get('x', 0))
            y = float(raw.get('y', 0))
            w = float(raw.get('w', 0))
            h = float(raw.get('h', 0))
        except (TypeError, ValueError):
            continue
        if w <= 0 or h <= 0:
            continue
        x = max(0.0, min(1.0, x))
        y = max(0.0, min(1.0, y))
        w = max(0.0, min(1.0 - x, w))
        h = max(0.0, min(1.0 - y, h))
        # 過大的框（> 35% 頁面）通常是模型把整段印刷誤框，丟掉
        if w * h > 0.35:
            continue
        boxes.append((x, y, w, h))
    return boxes


# ───────── Provider selector ─────────

ProviderName = Literal['ollama', 'gemini', 'auto']


def get_provider(prefer: ProviderName | None = None):
    """
    依環境變數選擇 provider。
    EMPOWERPAPER_LLM_PROVIDER:
      - "ollama" → 純本地（開發用，僅供實驗，PoC 已驗證 Gemma 4 26B 不堪用）
      - "gemini" → 純雲端（PoC 已驗證 Gemini 2.5 Flash 在正常考卷 14/14 全對）
      - "auto"   → 先試 ollama，失敗退 gemini

    預設值：'gemini'（產品線唯一可信路徑）
    """
    name = (prefer or os.environ.get('EMPOWERPAPER_LLM_PROVIDER', 'gemini')).lower()

    if name == 'ollama':
        return OllamaProvider()
    if name == 'gemini':
        return GeminiProvider()

    # auto: 嘗試 ollama，連不上就用 gemini
    try:
        ollama = OllamaProvider()
        with urlreq.urlopen(f'{ollama.base_url}/api/tags', timeout=2.0) as resp:
            if resp.status == 200:
                return ollama
    except Exception:
        pass

    return GeminiProvider()
