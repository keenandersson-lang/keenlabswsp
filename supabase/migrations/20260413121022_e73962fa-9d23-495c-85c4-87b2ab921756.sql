
-- Fix "Technology" → "Information Technology"
UPDATE symbols 
SET canonical_sector = 'Information Technology' 
WHERE canonical_sector = 'Technology' AND is_active = true;

-- Fix any other non-standard sector names
UPDATE symbols SET canonical_sector = 'Communication Services' WHERE canonical_sector IN ('Communications', 'Telecom') AND is_active = true;
