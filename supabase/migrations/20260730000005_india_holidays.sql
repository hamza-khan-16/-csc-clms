-- ============================================================
-- India National & Gazetted Holidays — 2025 & 2026
-- All holidays are college-wide (department_id = NULL)
-- Existing rows with the same date are left untouched (ON CONFLICT DO NOTHING)
-- ============================================================

INSERT INTO public.holidays (holiday_date, occasion, kind) VALUES
-- ── 2025 ──────────────────────────────────────────────────────
('2025-01-01', 'New Year''s Day',                    'National'),
('2025-01-14', 'Makar Sankranti / Pongal',           'National'),
('2025-01-26', 'Republic Day',                       'National'),
('2025-02-26', 'Maha Shivaratri',                    'Gazetted'),
('2025-03-14', 'Holi (Second Day)',                  'Gazetted'),
('2025-03-15', 'Holi',                               'Gazetted'),
('2025-03-31', 'Id-ul-Fitr (Eid)',                   'National'),
('2025-04-10', 'Ram Navami',                         'National'),
('2025-04-14', 'Dr. B.R. Ambedkar Jayanti',          'National'),
('2025-04-18', 'Good Friday',                        'National'),
('2025-05-01', 'Maharashtra Day / Labour Day',       'National'),
('2025-05-12', 'Buddha Purnima',                     'National'),
('2025-06-07', 'Id-ul-Zuha (Bakrid)',                'National'),
('2025-07-06', 'Muharram',                           'National'),
('2025-08-09', 'Nag Panchami',                       'Gazetted'),
('2025-08-15', 'Independence Day',                   'National'),
('2025-08-16', 'Parsi New Year (Pateti)',             'Gazetted'),
('2025-08-27', 'Ganesh Chaturthi',                   'National'),
('2025-09-05', 'Eid-e-Milad (Prophet''s Birthday)',  'National'),
('2025-10-02', 'Gandhi Jayanti / Dussehra',          'National'),
('2025-10-20', 'Diwali (Lakshmi Puja)',              'National'),
('2025-10-21', 'Diwali (Bali Pratipada)',            'National'),
('2025-10-22', 'Diwali (Bhai Dooj)',                 'National'),
('2025-11-05', 'Guru Nanak Jayanti',                 'National'),
('2025-11-15', 'Datta Jayanti',                      'Gazetted'),
('2025-12-25', 'Christmas Day',                      'National'),

-- ── 2026 ──────────────────────────────────────────────────────
('2026-01-01', 'New Year''s Day',                    'National'),
('2026-01-14', 'Makar Sankranti / Pongal',           'National'),
('2026-01-26', 'Republic Day',                       'National'),
('2026-02-15', 'Maha Shivaratri',                    'Gazetted'),
('2026-03-03', 'Holi (Second Day)',                  'Gazetted'),
('2026-03-04', 'Holi',                               'Gazetted'),
('2026-03-20', 'Id-ul-Fitr (Eid)',                   'National'),
('2026-03-28', 'Ram Navami',                         'National'),
('2026-04-03', 'Good Friday',                        'National'),
('2026-04-14', 'Dr. B.R. Ambedkar Jayanti',          'National'),
('2026-05-01', 'Maharashtra Day / Labour Day',       'National'),
('2026-05-31', 'Buddha Purnima',                     'National'),
('2026-05-27', 'Id-ul-Zuha (Bakrid)',                'National'),
('2026-06-26', 'Muharram',                           'National'),
('2026-08-15', 'Independence Day',                   'National'),
('2026-08-19', 'Ganesh Chaturthi',                   'National'),
('2026-08-26', 'Eid-e-Milad (Prophet''s Birthday)',  'National'),
('2026-09-05', 'Nag Panchami',                       'Gazetted'),
('2026-10-02', 'Gandhi Jayanti',                     'National'),
('2026-10-19', 'Dussehra (Vijaya Dashami)',          'National'),
('2026-11-08', 'Diwali (Lakshmi Puja)',              'National'),
('2026-11-09', 'Diwali (Bali Pratipada)',            'National'),
('2026-11-10', 'Diwali (Bhai Dooj)',                 'National'),
('2026-11-24', 'Guru Nanak Jayanti',                 'National'),
('2026-12-25', 'Christmas Day',                      'National')
ON CONFLICT DO NOTHING;
