-- =============================================================================
-- SecureScore demo seed data
--
-- Every seeded account uses the password: SecurePass2026
-- The bcrypt hash below was generated with cost factor 10 and verified
-- against that plaintext. It is committed deliberately because this file
-- seeds a throwaway demo database only; no real credential is stored here.
-- =============================================================================

INSERT INTO users (id, email, name, password_hash, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'admin@deakin.edu.au', 'Arjun Pahal',
   '$2b$10$zwtEcpNvb864ix7TzipeDevTQWa3oteck2QE.A8kNySlhvKSlByWC', 'admin'),
  ('22222222-2222-2222-2222-222222222222', 'lead@deakin.edu.au', 'AppAttack Lead',
   '$2b$10$zwtEcpNvb864ix7TzipeDevTQWa3oteck2QE.A8kNySlhvKSlByWC', 'lead'),
  ('33333333-3333-3333-3333-333333333333', 'dev@deakin.edu.au', 'Capstone Dev',
   '$2b$10$zwtEcpNvb864ix7TzipeDevTQWa3oteck2QE.A8kNySlhvKSlByWC', 'developer')
ON CONFLICT (email) DO NOTHING;

INSERT INTO projects (id, name, description, repository_url, owner_id,
                      current_score, rating, last_scanned_at) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'AppAttack',
   'Penetration testing and secure code review toolkit',
   'https://github.com/Hardhat-Enterprises/AppAttack',
   '22222222-2222-2222-2222-222222222222', 92, 'HEALTHY',  NOW() - INTERVAL '2 minutes'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'AutoAudit',
   'Automated cloud compliance assessment for Microsoft 365',
   'https://github.com/Hardhat-Enterprises/AutoAudit',
   '22222222-2222-2222-2222-222222222222', 74, 'MODERATE', NOW() - INTERVAL '15 minutes'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'PT-GUI',
   'Deakin Detonator Toolkit penetration testing GUI',
   'https://github.com/Hardhat-Enterprises/PT-GUI',
   '33333333-3333-3333-3333-333333333333', 61, 'MODERATE', NOW() - INTERVAL '1 hour'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'Smishing Detection',
   'Android and iOS application combating SMS phishing attacks',
   'https://github.com/Hardhat-Enterprises/smishing-backend',
   '33333333-3333-3333-3333-333333333333', 38, 'CRITICAL', NOW() - INTERVAL '3 hours'),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'Phoenix',
   'Cyber threat protection during bushfire and flood disasters',
   'https://github.com/Hardhat-Enterprises/Phoenix',
   '22222222-2222-2222-2222-222222222222', 85, 'HEALTHY',  NOW() - INTERVAL '30 minutes')
ON CONFLICT (name) DO NOTHING;
