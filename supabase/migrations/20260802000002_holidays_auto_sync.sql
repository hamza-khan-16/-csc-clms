-- ══════════════════════════════════════════════════════════════════════════════
-- Holidays 2025–2030  (clean, no duplicates, no API)
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.holidays
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

DELETE FROM public.holidays;

ALTER TABLE public.holidays
  DROP CONSTRAINT IF EXISTS holidays_holiday_date_key;
ALTER TABLE public.holidays
  ADD CONSTRAINT holidays_holiday_date_key UNIQUE (holiday_date);

CREATE INDEX IF NOT EXISTS idx_holidays_date
  ON public.holidays (holiday_date);

-- Each date appears exactly once. Where two holidays fall on the same date,
-- the more significant one is kept (e.g. Gandhi Jayanti kept over Mahatma Gandhi Birthday).

INSERT INTO public.holidays (holiday_date, occasion, kind, source) VALUES

-- ── 2025 ──────────────────────────────────────────────────────────────────────
('2025-01-14', 'Makar Sankranti / Pongal',          'National', 'system'),
('2025-01-23', 'Netaji Subhas Chandra Bose Jayanti', 'National', 'system'),
('2025-01-26', 'Republic Day',                       'National', 'system'),
('2025-02-19', 'Chhatrapati Shivaji Maharaj Jayanti','National', 'system'),
('2025-02-26', 'Maha Shivratri',                     'National', 'system'),
('2025-03-14', 'Holi',                               'National', 'system'),
('2025-03-31', 'Id-ul-Fitr (Eid al-Fitr)',           'National', 'system'),
('2025-04-06', 'Ram Navami',                         'National', 'system'),
('2025-04-10', 'Mahavir Jayanti',                    'National', 'system'),
('2025-04-14', 'Dr. B.R. Ambedkar Jayanti',          'National', 'system'),
('2025-04-18', 'Good Friday',                        'National', 'system'),
('2025-05-01', 'Maharashtra Day',                    'National', 'system'),
('2025-05-12', 'Buddha Purnima',                     'National', 'system'),
('2025-06-07', 'Id-ul-Zuha (Bakrid)',                'National', 'system'),
('2025-07-06', 'Muharram',                           'National', 'system'),
('2025-08-09', 'Raksha Bandhan',                     'National', 'system'),
('2025-08-15', 'Independence Day',                   'National', 'system'),
('2025-08-16', 'Janmashtami',                        'National', 'system'),
('2025-09-05', 'Id-e-Milad (Milad-un-Nabi)',         'National', 'system'),
('2025-10-02', 'Gandhi Jayanti',                     'National', 'system'),
('2025-10-20', 'Dussehra (Vijaya Dashami)',           'National', 'system'),
('2025-10-30', 'Diwali (Lakshmi Puja)',              'National', 'system'),
('2025-11-05', 'Guru Nanak Jayanti',                 'National', 'system'),
('2025-12-25', 'Christmas Day',                      'National', 'system'),

-- ── 2026 ──────────────────────────────────────────────────────────────────────
('2026-01-14', 'Makar Sankranti / Pongal',           'National', 'system'),
('2026-01-23', 'Netaji Subhas Chandra Bose Jayanti', 'National', 'system'),
('2026-01-26', 'Republic Day',                       'National', 'system'),
('2026-02-15', 'Maha Shivratri',                     'National', 'system'),
('2026-03-04', 'Holi',                               'National', 'system'),
('2026-03-20', 'Id-ul-Fitr (Eid al-Fitr)',           'National', 'system'),
('2026-03-26', 'Ram Navami',                         'National', 'system'),
('2026-03-30', 'Mahavir Jayanti',                    'National', 'system'),
('2026-04-03', 'Good Friday',                        'National', 'system'),
('2026-04-14', 'Dr. B.R. Ambedkar Jayanti',          'National', 'system'),
('2026-04-30', 'Buddha Purnima',                     'National', 'system'),
('2026-05-01', 'Maharashtra Day',                    'National', 'system'),
('2026-05-27', 'Id-ul-Zuha (Bakrid)',                'National', 'system'),
('2026-06-16', 'Muharram',                           'National', 'system'),
('2026-08-15', 'Independence Day',                   'National', 'system'),
('2026-08-25', 'Raksha Bandhan',                     'National', 'system'),
('2026-08-26', 'Janmashtami',                        'National', 'system'),
('2026-09-09', 'Id-e-Milad (Milad-un-Nabi)',         'National', 'system'),
('2026-10-02', 'Gandhi Jayanti',                     'National', 'system'),
('2026-10-19', 'Dussehra (Vijaya Dashami)',           'National', 'system'),
('2026-11-08', 'Diwali (Lakshmi Puja)',              'National', 'system'),
('2026-11-24', 'Guru Nanak Jayanti',                 'National', 'system'),
('2026-12-25', 'Christmas Day',                      'National', 'system'),

-- ── 2027 ──────────────────────────────────────────────────────────────────────
('2027-01-14', 'Makar Sankranti / Pongal',           'National', 'system'),
('2027-01-23', 'Netaji Subhas Chandra Bose Jayanti', 'National', 'system'),
('2027-01-26', 'Republic Day',                       'National', 'system'),
('2027-02-05', 'Maha Shivratri',                     'National', 'system'),
('2027-03-10', 'Id-ul-Fitr (Eid al-Fitr)',           'National', 'system'),
('2027-03-22', 'Holi',                               'National', 'system'),
('2027-04-14', 'Dr. B.R. Ambedkar Jayanti',          'National', 'system'),
('2027-04-15', 'Ram Navami',                         'National', 'system'),
('2027-04-16', 'Mahavir Jayanti',                    'National', 'system'),
('2027-04-26', 'Good Friday',                        'National', 'system'),
('2027-05-01', 'Maharashtra Day',                    'National', 'system'),
('2027-05-17', 'Id-ul-Zuha (Bakrid)',                'National', 'system'),
('2027-05-20', 'Buddha Purnima',                     'National', 'system'),
('2027-06-06', 'Muharram',                           'National', 'system'),
('2027-08-15', 'Independence Day & Janmashtami',     'National', 'system'),
('2027-08-29', 'Id-e-Milad (Milad-un-Nabi)',         'National', 'system'),
('2027-09-03', 'Raksha Bandhan',                     'National', 'system'),
('2027-10-02', 'Gandhi Jayanti',                     'National', 'system'),
('2027-10-08', 'Dussehra (Vijaya Dashami)',           'National', 'system'),
('2027-10-29', 'Diwali (Lakshmi Puja)',              'National', 'system'),
('2027-11-13', 'Guru Nanak Jayanti',                 'National', 'system'),
('2027-12-25', 'Christmas Day',                      'National', 'system'),

-- ── 2028 ──────────────────────────────────────────────────────────────────────
('2028-01-14', 'Makar Sankranti / Pongal',           'National', 'system'),
('2028-01-23', 'Netaji Subhas Chandra Bose Jayanti', 'National', 'system'),
('2028-01-26', 'Republic Day & Maha Shivratri',      'National', 'system'),
('2028-02-27', 'Id-ul-Fitr (Eid al-Fitr)',           'National', 'system'),
('2028-03-11', 'Holi',                               'National', 'system'),
('2028-04-03', 'Ram Navami',                         'National', 'system'),
('2028-04-04', 'Mahavir Jayanti',                    'National', 'system'),
('2028-04-14', 'Good Friday & Dr. B.R. Ambedkar Jayanti', 'National', 'system'),
('2028-05-01', 'Maharashtra Day',                    'National', 'system'),
('2028-05-05', 'Id-ul-Zuha (Bakrid)',                'National', 'system'),
('2028-05-07', 'Buddha Purnima',                     'National', 'system'),
('2028-05-25', 'Muharram',                           'National', 'system'),
('2028-08-03', 'Janmashtami',                        'National', 'system'),
('2028-08-15', 'Independence Day',                   'National', 'system'),
('2028-08-17', 'Id-e-Milad (Milad-un-Nabi)',         'National', 'system'),
('2028-08-21', 'Raksha Bandhan',                     'National', 'system'),
('2028-10-02', 'Gandhi Jayanti',                     'National', 'system'),
('2028-10-24', 'Dussehra (Vijaya Dashami)',           'National', 'system'),
('2028-11-02', 'Guru Nanak Jayanti',                 'National', 'system'),
('2028-11-05', 'Diwali (Lakshmi Puja)',              'National', 'system'),
('2028-12-25', 'Christmas Day',                      'National', 'system'),

-- ── 2029 ──────────────────────────────────────────────────────────────────────
('2029-01-14', 'Makar Sankranti / Pongal',           'National', 'system'),
('2029-01-23', 'Netaji Subhas Chandra Bose Jayanti', 'National', 'system'),
('2029-01-26', 'Republic Day',                       'National', 'system'),
('2029-02-13', 'Maha Shivratri',                     'National', 'system'),
('2029-02-17', 'Id-ul-Fitr (Eid al-Fitr)',           'National', 'system'),
('2029-03-01', 'Holi',                               'National', 'system'),
('2029-03-23', 'Ram Navami',                         'National', 'system'),
('2029-03-24', 'Mahavir Jayanti',                    'National', 'system'),
('2029-03-30', 'Good Friday',                        'National', 'system'),
('2029-04-14', 'Dr. B.R. Ambedkar Jayanti',          'National', 'system'),
('2029-04-24', 'Id-ul-Zuha (Bakrid)',                'National', 'system'),
('2029-04-27', 'Buddha Purnima',                     'National', 'system'),
('2029-05-01', 'Maharashtra Day',                    'National', 'system'),
('2029-05-14', 'Muharram',                           'National', 'system'),
('2029-08-06', 'Id-e-Milad (Milad-un-Nabi)',         'National', 'system'),
('2029-08-10', 'Raksha Bandhan',                     'National', 'system'),
('2029-08-15', 'Independence Day',                   'National', 'system'),
('2029-08-22', 'Janmashtami',                        'National', 'system'),
('2029-10-02', 'Gandhi Jayanti',                     'National', 'system'),
('2029-10-14', 'Dussehra (Vijaya Dashami)',           'National', 'system'),
('2029-10-26', 'Diwali (Lakshmi Puja)',              'National', 'system'),
('2029-11-22', 'Guru Nanak Jayanti',                 'National', 'system'),
('2029-12-25', 'Christmas Day',                      'National', 'system'),

-- ── 2030 ──────────────────────────────────────────────────────────────────────
('2030-01-14', 'Makar Sankranti / Pongal',           'National', 'system'),
('2030-01-23', 'Netaji Subhas Chandra Bose Jayanti', 'National', 'system'),
('2030-01-26', 'Republic Day',                       'National', 'system'),
('2030-02-06', 'Id-ul-Fitr (Eid al-Fitr)',           'National', 'system'),
('2030-03-04', 'Maha Shivratri',                     'National', 'system'),
('2030-03-20', 'Holi',                               'National', 'system'),
('2030-04-09', 'Ram Navami',                         'National', 'system'),
('2030-04-12', 'Mahavir Jayanti',                    'National', 'system'),
('2030-04-14', 'Id-ul-Zuha (Bakrid) & Dr. B.R. Ambedkar Jayanti', 'National', 'system'),
('2030-04-19', 'Good Friday',                        'National', 'system'),
('2030-05-01', 'Maharashtra Day',                    'National', 'system'),
('2030-05-03', 'Muharram',                           'National', 'system'),
('2030-05-16', 'Buddha Purnima',                     'National', 'system'),
('2030-07-26', 'Id-e-Milad (Milad-un-Nabi)',         'National', 'system'),
('2030-07-30', 'Raksha Bandhan',                     'National', 'system'),
('2030-08-11', 'Janmashtami',                        'National', 'system'),
('2030-08-15', 'Independence Day',                   'National', 'system'),
('2030-10-02', 'Gandhi Jayanti',                     'National', 'system'),
('2030-10-03', 'Dussehra (Vijaya Dashami)',           'National', 'system'),
('2030-10-15', 'Diwali (Lakshmi Puja)',              'National', 'system'),
('2030-11-10', 'Guru Nanak Jayanti',                 'National', 'system'),
('2030-12-25', 'Christmas Day',                      'National', 'system');
