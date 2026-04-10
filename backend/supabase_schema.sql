-- EmpowerPaper Supabase schema
-- 在 Supabase Dashboard → SQL Editor → New query 貼進去執行

-- 1. papers 表：每張上傳的考卷
CREATE TABLE IF NOT EXISTS papers (
  paper_id        TEXT PRIMARY KEY,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  original_path   TEXT NOT NULL,         -- Storage 內路徑 (papers/uploads/xxx.webp)
  cleaned_paths   JSONB DEFAULT '{}'::jsonb,  -- 不同 darkness 的清理結果 {"1.0": "papers/cleaned/...", "1.5": "..."}
  darkness        REAL DEFAULT 1.0,
  rotation        INTEGER DEFAULT 0,
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 2. crops 表：框選的題目
CREATE TABLE IF NOT EXISTS crops (
  crop_id         TEXT PRIMARY KEY,
  paper_id        TEXT NOT NULL REFERENCES papers(paper_id) ON DELETE CASCADE,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  image_path      TEXT,                  -- Storage 內路徑
  x               INTEGER NOT NULL,
  y               INTEGER NOT NULL,
  width           INTEGER NOT NULL,
  height          INTEGER NOT NULL,
  tags            TEXT[] DEFAULT '{}',
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 索引
CREATE INDEX IF NOT EXISTS idx_papers_user_id ON papers(user_id);
CREATE INDEX IF NOT EXISTS idx_papers_created_at ON papers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crops_paper_id ON crops(paper_id);
CREATE INDEX IF NOT EXISTS idx_crops_user_id ON crops(user_id);

-- 4. updated_at 自動更新 trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_papers_updated_at ON papers;
CREATE TRIGGER update_papers_updated_at
  BEFORE UPDATE ON papers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 5. RLS 暫時不開（之後接 Auth 再開）
-- ALTER TABLE papers ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE crops ENABLE ROW LEVEL SECURITY;
