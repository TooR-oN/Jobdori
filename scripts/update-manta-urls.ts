import { neon } from '@neondatabase/serverless'

const DATABASE_URL = process.env.DATABASE_URL || ''
const db = neon(DATABASE_URL)

const mantaUrls: Record<string, string> = {
  'Under the Oak Tree': 'https://manta.net/en/series/under-the-oak-tree?seriesId=1255',
  "The Duke's Fluffy Secret": 'https://manta.net/en/series/the-duke-s-fluffy-secret?seriesId=3779',
  'Degenerate': 'https://manta.net/en/series/degenerate?seriesId=3873',
  'A Wicked Husband': 'https://manta.net/en/series/a-wicked-husband?seriesId=3815',
  'Devoured: The Serpent and the Pomegranate': 'https://manta.net/en/series/devoured-the-serpent-and-the-pomegranate?seriesId=3980',
  "My Master Doesn't Bite!": 'https://manta.net/en/series/my-master-doesn-t-bite?seriesId=3828',
  "Don't Tell My Brother!": 'https://manta.net/en/series/don-t-tell-my-brother-full-ver?seriesId=3802',
  'Guilty Office': 'https://manta.net/en/series/guilty-office-full-ver?seriesId=3906',
  'How About a Cosmic Horror?': 'https://manta.net/en/series/how-about-a-cosmic-horror?seriesId=3750',
  'Predatory Marriage': 'https://manta.net/en/series/predatory-marriage?seriesId=2661',
  'The Beast Within': 'https://manta.net/en/series/the-beast-within?seriesId=3782',
  'From Sandbox to Bed': 'https://manta.net/en/series/from-sandbox-to-bed-full-ver?seriesId=3740',
  'Dangerous': 'https://manta.net/en/series/dangerous-full-ver?seriesId=3326',
  'Prison Love': 'https://manta.net/en/series/prison-love?seriesId=2669',
  'Betrayal of Dignity': 'https://manta.net/en/series/betrayal-of-dignity?seriesId=2067',
  'F My Ex': 'https://manta.net/en/series/f-my-ex?seriesId=3597',
  'Tempest Night': 'https://manta.net/en/series/tempest-night?seriesId=2663',
  'High Society': 'https://manta.net/en/series/high-society?seriesId=2441',
  'Her Merry Obsession': 'https://manta.net/en/series/her-merry-obsession?seriesId=3292',
  'Violet Romance': 'https://manta.net/en/series/violet-romance-full-ver?seriesId=4001',
}

async function updateMantaUrls() {
  console.log('🚀 Starting Manta URL update...')
  
  // 먼저 manta_url 컬럼 추가 (없으면)
  try {
    await db`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'titles' AND column_name = 'manta_url'
        ) THEN
          ALTER TABLE titles ADD COLUMN manta_url TEXT;
        END IF;
      END $$
    `
    console.log('✅ manta_url column ensured')
  } catch (error) {
    console.error('Failed to add manta_url column:', error)
    return
  }
  
  let updated = 0
  for (const [title, url] of Object.entries(mantaUrls)) {
    try {
      const result = await db`
        UPDATE titles 
        SET manta_url = ${url}
        WHERE name = ${title}
      `
      console.log(`✅ Updated: ${title}`)
      updated++
    } catch (error) {
      console.error(`❌ Failed to update ${title}:`, error)
    }
  }
  
  console.log(`\n✅ Migration completed! Updated ${updated} titles.`)
}

updateMantaUrls().catch(console.error)
