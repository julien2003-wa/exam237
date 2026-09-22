-- Exam237 : extension non destructive de la base JulienLab.
CREATE TABLE IF NOT EXISTS ex237_classes (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  exam_type TEXT NOT NULL CHECK (exam_type IN ('BEPC','PROBATOIRE','BACCALAUREAT')),
  series TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO ex237_classes (code,label,exam_type,series,display_order) VALUES
('3E','3e','BEPC',NULL,10),('1A','Première A','PROBATOIRE','A',20),('1C','Première C','PROBATOIRE','C',30),('1D','Première D','PROBATOIRE','D',40),('1TI','Première TI','PROBATOIRE','TI',50),('TA','Terminale A','BACCALAUREAT','A',60),('TC','Terminale C','BACCALAUREAT','C',70),('TD','Terminale D','BACCALAUREAT','D',80),('TTI','Terminale TI','BACCALAUREAT','TI',90)
ON CONFLICT (code) DO UPDATE SET label=EXCLUDED.label,exam_type=EXCLUDED.exam_type,series=EXCLUDED.series,display_order=EXCLUDED.display_order;
CREATE TABLE IF NOT EXISTS ex237_user_profiles (user_id UUID PRIMARY KEY REFERENCES jl_users(id) ON DELETE CASCADE,display_name TEXT,class_code TEXT REFERENCES ex237_classes(code),whatsapp_number TEXT,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS ex237_subjects (id UUID PRIMARY KEY,name TEXT NOT NULL,slug TEXT UNIQUE NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS ex237_class_subjects (class_code TEXT NOT NULL REFERENCES ex237_classes(code) ON DELETE CASCADE,subject_id UUID NOT NULL REFERENCES ex237_subjects(id) ON DELETE CASCADE,display_order INTEGER NOT NULL DEFAULT 0,PRIMARY KEY (class_code,subject_id));
CREATE TABLE IF NOT EXISTS ex237_papers (id UUID PRIMARY KEY,class_code TEXT NOT NULL REFERENCES ex237_classes(code),subject_id UUID NOT NULL REFERENCES ex237_subjects(id),exam_year INTEGER NOT NULL CHECK (exam_year BETWEEN 2000 AND 2100),session_label TEXT NOT NULL DEFAULT 'Session normale',title TEXT NOT NULL,paper_url TEXT NOT NULL,source_note TEXT,is_premium BOOLEAN NOT NULL DEFAULT TRUE,status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),published_at TIMESTAMPTZ,created_by TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(class_code,subject_id,exam_year,session_label));
CREATE INDEX IF NOT EXISTS ex237_papers_browse_idx ON ex237_papers(class_code,exam_year DESC,subject_id) WHERE status='published';
CREATE TABLE IF NOT EXISTS ex237_corrections (id UUID PRIMARY KEY,paper_id UUID NOT NULL REFERENCES ex237_papers(id) ON DELETE CASCADE,title TEXT NOT NULL DEFAULT 'Correction vidéo',video_url TEXT NOT NULL,display_order INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),published_at TIMESTAMPTZ,created_by TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS ex237_corrections_paper_idx ON ex237_corrections(paper_id,display_order) WHERE status='published';
CREATE TABLE IF NOT EXISTS ex237_content_views (id UUID PRIMARY KEY,user_id UUID REFERENCES jl_users(id) ON DELETE SET NULL,paper_id UUID NOT NULL REFERENCES ex237_papers(id) ON DELETE CASCADE,view_type TEXT NOT NULL CHECK (view_type IN ('paper','correction')),viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS ex237_content_views_user_idx ON ex237_content_views(user_id,viewed_at DESC);
