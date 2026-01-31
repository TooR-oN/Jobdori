// ============================================
// Next.js App Router API Route Handler
// Hono 앱을 Next.js Route Handler로 래핑
// ============================================

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { handle } from 'hono/vercel'
import { neon } from '@neondatabase/serverless'
import * as XLSX from 'xlsx'

// ============================================
// Database Setup
// ============================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sql: any = null

function getDatabase(): any {
  if (!sql) {
    const dbUrl = process.env.DATABASE_URL
    if (!dbUrl) {
      throw new Error('DATABASE_URL environment variable is not set')
    }
    sql = neon(dbUrl)
  }
  return sql
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function query(strings: TemplateStringsArray, ...values: any[]): Promise<any[]> {
  const db = getDatabase()
  const result = await db(strings, ...values)
  return result as any[]
}

// DB 마이그레이션 - page1_illegal_count 컬럼 추가
let dbMigrationDone = false
async function ensureDbMigration() {
  if (dbMigrationDone) return
  try {
    const db = getDatabase()
    // manta_rankings 테이블에 page1_illegal_count 컬럼 추가 (없으면)
    await db`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'manta_rankings' AND column_name = 'page1_illegal_count'
        ) THEN
          ALTER TABLE manta_rankings ADD COLUMN page1_illegal_count INTEGER DEFAULT 0;
        END IF;
      END $$
    `
    // manta_ranking_history 테이블에도 추가
    await db`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'manta_ranking_history' AND column_name = 'page1_illegal_count'
        ) THEN
          ALTER TABLE manta_ranking_history ADD COLUMN page1_illegal_count INTEGER DEFAULT 0;
        END IF;
      END $$
    `
    // pending_reviews 테이블에 domain UNIQUE 제약조건 추가
    await db`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint 
          WHERE conname = 'pending_reviews_domain_unique'
        ) THEN
          ALTER TABLE pending_reviews ADD CONSTRAINT pending_reviews_domain_unique UNIQUE (domain);
        END IF;
      END $$
    `
    
    // report_tracking 테이블 생성 (없으면)
    await db`
      CREATE TABLE IF NOT EXISTS report_tracking (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(50) NOT NULL,
        url TEXT NOT NULL,
        domain VARCHAR(255) NOT NULL,
        report_status VARCHAR(20) DEFAULT '미신고',
        report_id VARCHAR(50),
        reason TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(session_id, url)
      )
    `
    
    // report_tracking 인덱스 생성
    await db`
      CREATE INDEX IF NOT EXISTS idx_report_tracking_session 
      ON report_tracking(session_id, report_status)
    `
    
    // report_tracking에 title 컬럼 추가 (없으면)
    await db`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'report_tracking' AND column_name = 'title'
        ) THEN
          ALTER TABLE report_tracking ADD COLUMN title VARCHAR(255);
        END IF;
      END $$
    `
    
    // title 인덱스 생성
    await db`
      CREATE INDEX IF NOT EXISTS idx_report_tracking_title 
      ON report_tracking(title)
    `
    
    // report_tracking에 search_query, page, rank 컬럼 추가 (없으면)
    await db`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'report_tracking' AND column_name = 'search_query'
        ) THEN
          ALTER TABLE report_tracking ADD COLUMN search_query VARCHAR(255);
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'report_tracking' AND column_name = 'page'
        ) THEN
          ALTER TABLE report_tracking ADD COLUMN page INTEGER DEFAULT 1;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'report_tracking' AND column_name = 'rank'
        ) THEN
          ALTER TABLE report_tracking ADD COLUMN rank INTEGER DEFAULT 1;
        END IF;
      END $$
    `
    
    // report_uploads 테이블 생성 (없으면)
    await db`
      CREATE TABLE IF NOT EXISTS report_uploads (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(50) NOT NULL,
        report_id VARCHAR(50),
        file_name VARCHAR(255),
        matched_count INTEGER DEFAULT 0,
        total_urls_in_html INTEGER DEFAULT 0,
        uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `
    
    // report_reasons 테이블 생성 (없으면) - 신고 사유 관리
    await db`
      CREATE TABLE IF NOT EXISTS report_reasons (
        id SERIAL PRIMARY KEY,
        reason_text TEXT NOT NULL UNIQUE,
        usage_count INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `
    
    // excluded_urls 테이블 생성 (없으면) - 신고 제외 URL 관리
    await db`
      CREATE TABLE IF NOT EXISTS excluded_urls (
        id SERIAL PRIMARY KEY,
        url TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `
    
    // titles 테이블에 manta_url 컬럼 추가 (없으면)
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
    
    dbMigrationDone = true
  } catch (error) {
    console.error('DB migration error:', error)
  }
}

// ============================================
// Auth Setup - Signed Token (HMAC)
// ============================================

const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || 'ridilegal'
const SECRET_KEY = process.env.SECRET_KEY || 'jobdori-secret-key-2024'

async function createSignedToken(payload: { exp: number }): Promise<string> {
  const encoder = new TextEncoder()
  const data = JSON.stringify(payload)
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SECRET_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
  return `${btoa(data)}.${signatureBase64}`
}

async function verifySignedToken(token: string): Promise<boolean> {
  try {
    const [dataBase64, signatureBase64] = token.split('.')
    if (!dataBase64 || !signatureBase64) return false
    
    const data = atob(dataBase64)
    const payload = JSON.parse(data)
    
    // 만료 확인
    if (payload.exp && payload.exp < Date.now()) return false
    
    // 서명 검증
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(SECRET_KEY),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )
    const signature = Uint8Array.from(atob(signatureBase64), c => c.charCodeAt(0))
    return await crypto.subtle.verify('HMAC', key, signature, encoder.encode(data))
  } catch {
    return false
  }
}

// ============================================
// Hono App Setup
// ============================================

// NOTE: basePath('/api') 복원 - Hono 공식 문서 권장 설정
// https://hono.dev/docs/getting-started/nextjs
// Next.js App Router + Hono 통합 시 basePath('/api') 필요
const app = new Hono().basePath('/api')

app.use('*', cors())

// ============================================
// Auth Routes
// ============================================

app.post('/auth/login', async (c) => {
  try {
    const { password } = await c.req.json()
    if (password === ACCESS_PASSWORD) {
      // 24시간 후 만료
      const exp = Date.now() + 24 * 60 * 60 * 1000
      const token = await createSignedToken({ exp })
      setCookie(c, 'session_token', token, {
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        maxAge: 60 * 60 * 24,
        path: '/'
      })
      return c.json({ success: true })
    }
    return c.json({ success: false, error: '비밀번호가 올바르지 않습니다.' }, 401)
  } catch {
    return c.json({ success: false, error: '요청 처리 중 오류가 발생했습니다.' }, 500)
  }
})

app.post('/auth/logout', (c) => {
  deleteCookie(c, 'session_token', { path: '/' })
  return c.json({ success: true })
})

app.get('/auth/status', async (c) => {
  const sessionToken = getCookie(c, 'session_token')
  if (!sessionToken) return c.json({ authenticated: false })
  const isValid = await verifySignedToken(sessionToken)
  return c.json({ authenticated: isValid })
})

// Auth Middleware - API 라우트 보호
app.use('*', async (c, next) => {
  const path = c.req.path
  const publicPaths = ['/api/auth/login', '/api/auth/status', '/api/auth/logout']
  if (publicPaths.some(p => path === p || path.startsWith(p))) return next()
  
  const sessionToken = getCookie(c, 'session_token')
  const isValid = sessionToken ? await verifySignedToken(sessionToken) : false
  
  if (!isValid) {
    return c.json({ success: false, error: 'Unauthorized' }, 401)
  }
  
  return next()
})

// ============================================
// Pending Reviews API
// ============================================

app.get('/pending', async (c) => {
  try {
    await ensureDbMigration()
    const page = parseInt(c.req.query('page') || '1')
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20'), 1), 100)
    const judgment = c.req.query('judgment')
    const offset = (page - 1) * limit

    let items: any[]
    let total: number

    if (judgment && ['likely_illegal', 'likely_legal', 'uncertain'].includes(judgment)) {
      const countResult = await query`
        SELECT COUNT(*) as count FROM pending_reviews WHERE llm_judgment = ${judgment}
      `
      total = parseInt(countResult[0]?.count || '0')
      items = await query`
        SELECT * FROM pending_reviews 
        WHERE llm_judgment = ${judgment}
        ORDER BY created_at DESC 
        LIMIT ${limit} OFFSET ${offset}
      `
    } else {
      const countResult = await query`SELECT COUNT(*) as count FROM pending_reviews`
      total = parseInt(countResult[0]?.count || '0')
      items = await query`
        SELECT * FROM pending_reviews 
        ORDER BY created_at DESC 
        LIMIT ${limit} OFFSET ${offset}
      `
    }

    return c.json({
      success: true,
      count: total,
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    console.error('Error loading pending reviews:', error)
    return c.json({ success: false, error: 'Failed to load pending reviews' }, 500)
  }
})

// AI 일괄 검토 API
app.post('/pending/ai-review', async (c) => {
  try {
    await ensureDbMigration()
    
    // Gemini API 키 확인
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return c.json({ success: false, error: 'GEMINI_API_KEY not configured' }, 500)
    }

    // 승인 대기 항목 가져오기
    const pendingItems = await query`
      SELECT id, domain, urls, titles, llm_judgment, llm_reason 
      FROM pending_reviews 
      ORDER BY created_at DESC
    `

    if (pendingItems.length === 0) {
      return c.json({ success: true, processed: 0, message: '처리할 항목이 없습니다.' })
    }

    // 불법 사이트 목록 가져오기
    const illegalSites = await query`SELECT domain FROM sites WHERE type = 'illegal'`
    const illegalDomains = new Set(illegalSites.map((s: any) => s.domain.toLowerCase()))

    // 합법 사이트 목록 가져오기
    const legalSites = await query`SELECT domain FROM sites WHERE type = 'legal'`
    const legalDomains = new Set(legalSites.map((s: any) => s.domain.toLowerCase()))

    let processed = 0
    const results: any[] = []

    for (const item of pendingItems) {
      const domain = item.domain.toLowerCase()
      
      // 이미 불법으로 등록된 경우
      if (illegalDomains.has(domain)) {
        // 불법으로 처리
        await query`INSERT INTO sites (domain, type) VALUES (${domain}, 'illegal') ON CONFLICT (domain, type) DO NOTHING`
        await query`DELETE FROM pending_reviews WHERE id = ${item.id}`
        processed++
        results.push({ domain, action: 'approved', reason: 'Already in illegal list' })
        continue
      }
      
      // 이미 합법으로 등록된 경우
      if (legalDomains.has(domain)) {
        // 합법으로 처리 (삭제)
        await query`DELETE FROM pending_reviews WHERE id = ${item.id}`
        processed++
        results.push({ domain, action: 'rejected', reason: 'Already in legal list' })
        continue
      }

      // LLM 판단이 likely_illegal인 경우 자동 승인
      if (item.llm_judgment === 'likely_illegal') {
        await query`INSERT INTO sites (domain, type) VALUES (${domain}, 'illegal') ON CONFLICT (domain, type) DO NOTHING`
        await query`DELETE FROM pending_reviews WHERE id = ${item.id}`
        processed++
        results.push({ domain, action: 'approved', reason: item.llm_reason || 'LLM: likely_illegal' })
        continue
      }

      // LLM 판단이 likely_legal인 경우 자동 거부
      if (item.llm_judgment === 'likely_legal') {
        await query`INSERT INTO sites (domain, type) VALUES (${domain}, 'legal') ON CONFLICT (domain, type) DO NOTHING`
        await query`DELETE FROM pending_reviews WHERE id = ${item.id}`
        processed++
        results.push({ domain, action: 'rejected', reason: item.llm_reason || 'LLM: likely_legal' })
        continue
      }

      // uncertain인 경우 Gemini로 재판단
      try {
        const prompt = `다음 도메인이 웹툰/웹소설 불법 복제 사이트인지 판단해주세요.

도메인: ${domain}
관련 작품: ${JSON.parse(item.titles || '[]').join(', ')}
URL 예시: ${JSON.parse(item.urls || '[]').slice(0, 3).join(', ')}

불법 복제 사이트의 특징:
1. 유료 웹툰/웹소설을 무단으로 업로드
2. 광고 수익을 위한 불법 콘텐츠 제공
3. 도메인에 manga, manhwa, comic, webtoon, novel, read 등 포함
4. 한국/일본 만화를 영어로 번역하여 제공

응답 형식 (JSON만):
{"judgment": "illegal" 또는 "legal", "confidence": 0.0~1.0, "reason": "판단 이유"}`

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.1 }
            })
          }
        )

        if (response.ok) {
          const data = await response.json()
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
          const jsonMatch = text.match(/\{[\s\S]*\}/)
          
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0])
            
            if (result.judgment === 'illegal' && result.confidence >= 0.7) {
              await query`INSERT INTO sites (domain, type) VALUES (${domain}, 'illegal') ON CONFLICT (domain, type) DO NOTHING`
              await query`DELETE FROM pending_reviews WHERE id = ${item.id}`
              processed++
              results.push({ domain, action: 'approved', reason: result.reason })
            } else if (result.judgment === 'legal' && result.confidence >= 0.7) {
              await query`INSERT INTO sites (domain, type) VALUES (${domain}, 'legal') ON CONFLICT (domain, type) DO NOTHING`
              await query`DELETE FROM pending_reviews WHERE id = ${item.id}`
              processed++
              results.push({ domain, action: 'rejected', reason: result.reason })
            } else {
              // 확신이 낮으면 스킵
              results.push({ domain, action: 'skipped', reason: `Low confidence: ${result.confidence}` })
            }
          }
        }
      } catch (aiError) {
        console.error(`AI review error for ${domain}:`, aiError)
        results.push({ domain, action: 'error', reason: String(aiError) })
      }
    }

    return c.json({ 
      success: true, 
      processed, 
      total: pendingItems.length,
      results,
      message: `${processed}/${pendingItems.length} 항목 처리 완료` 
    })
  } catch (error) {
    console.error('AI review error:', error)
    return c.json({ success: false, error: 'AI review failed' }, 500)
  }
})

// ============================================
// Review API (승인/거부)
// ============================================

app.post('/review', async (c) => {
  try {
    await ensureDbMigration()
    const { id, action } = await c.req.json()
    
    if (!id || !action) {
      return c.json({ success: false, error: 'Missing id or action' }, 400)
    }
    
    const items = await query`SELECT * FROM pending_reviews WHERE id = ${parseInt(id)}`
    if (items.length === 0) {
      return c.json({ success: false, error: 'Item not found' }, 404)
    }
    
    const item = items[0]
    const domain = item.domain.toLowerCase()
    
    if (action === 'approve') {
      // 불법 사이트로 등록
      await query`INSERT INTO sites (domain, type) VALUES (${domain}, 'illegal') ON CONFLICT (domain, type) DO NOTHING`
      await query`DELETE FROM pending_reviews WHERE id = ${parseInt(id)}`
      return c.json({ success: true, action: 'approved', domain })
    } else if (action === 'reject') {
      // 합법 사이트로 등록 (선택적)
      await query`INSERT INTO sites (domain, type) VALUES (${domain}, 'legal') ON CONFLICT (domain, type) DO NOTHING`
      await query`DELETE FROM pending_reviews WHERE id = ${parseInt(id)}`
      return c.json({ success: true, action: 'rejected', domain })
    } else {
      return c.json({ success: false, error: 'Invalid action' }, 400)
    }
  } catch (error) {
    console.error('Review error:', error)
    return c.json({ success: false, error: 'Review failed' }, 500)
  }
})

// 일괄 처리 API
app.post('/review/bulk', async (c) => {
  try {
    await ensureDbMigration()
    const { ids, action } = await c.req.json()
    
    if (!ids || !Array.isArray(ids) || !action) {
      return c.json({ success: false, error: 'Missing ids or action' }, 400)
    }
    
    let processed = 0
    let failed = 0
    
    for (const id of ids) {
      try {
        const items = await query`SELECT * FROM pending_reviews WHERE id = ${parseInt(id)}`
        if (items.length === 0) {
          failed++
          continue
        }
        
        const item = items[0]
        const domain = item.domain.toLowerCase()
        
        if (action === 'approve') {
          await query`INSERT INTO sites (domain, type) VALUES (${domain}, 'illegal') ON CONFLICT (domain, type) DO NOTHING`
        } else if (action === 'reject') {
          await query`INSERT INTO sites (domain, type) VALUES (${domain}, 'legal') ON CONFLICT (domain, type) DO NOTHING`
        }
        
        await query`DELETE FROM pending_reviews WHERE id = ${parseInt(id)}`
        processed++
      } catch {
        failed++
      }
    }
    
    return c.json({ success: true, processed, failed })
  } catch (error) {
    console.error('Bulk review error:', error)
    return c.json({ success: false, error: 'Bulk review failed' }, 500)
  }
})

// ============================================
// Sites API
// ============================================

app.get('/sites/:type', async (c) => {
  try {
    await ensureDbMigration()
    const type = c.req.param('type')
    if (type !== 'illegal' && type !== 'legal') {
      return c.json({ success: false, error: 'Invalid type' }, 400)
    }
    
    const page = parseInt(c.req.query('page') || '1')
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50'), 1), 100)
    const search = c.req.query('search')
    const offset = (page - 1) * limit
    
    let sites: any[]
    let total: number
    
    if (search) {
      const searchPattern = `%${search.toLowerCase()}%`
      const countResult = await query`
        SELECT COUNT(*) as count FROM sites 
        WHERE type = ${type} AND LOWER(domain) LIKE ${searchPattern}
      `
      total = parseInt(countResult[0]?.count || '0')
      sites = await query`
        SELECT * FROM sites 
        WHERE type = ${type} AND LOWER(domain) LIKE ${searchPattern}
        ORDER BY domain
        LIMIT ${limit} OFFSET ${offset}
      `
    } else {
      const countResult = await query`SELECT COUNT(*) as count FROM sites WHERE type = ${type}`
      total = parseInt(countResult[0]?.count || '0')
      sites = await query`
        SELECT * FROM sites WHERE type = ${type} 
        ORDER BY domain
        LIMIT ${limit} OFFSET ${offset}
      `
    }
    
    return c.json({
      success: true,
      type,
      count: total,
      sites,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    console.error('Error loading sites:', error)
    return c.json({ success: false, error: 'Failed to load sites' }, 500)
  }
})

app.post('/sites/:type', async (c) => {
  try {
    await ensureDbMigration()
    const type = c.req.param('type')
    if (type !== 'illegal' && type !== 'legal') {
      return c.json({ success: false, error: 'Invalid type' }, 400)
    }
    
    const { domain } = await c.req.json()
    if (!domain) {
      return c.json({ success: false, error: 'Missing domain' }, 400)
    }
    
    await query`INSERT INTO sites (domain, type) VALUES (${domain.toLowerCase()}, ${type}) ON CONFLICT (domain, type) DO NOTHING`
    return c.json({ success: true, domain, type })
  } catch (error) {
    console.error('Error adding site:', error)
    return c.json({ success: false, error: 'Failed to add site' }, 500)
  }
})

app.delete('/sites/:type/:domain', async (c) => {
  try {
    await ensureDbMigration()
    const type = c.req.param('type')
    const domain = decodeURIComponent(c.req.param('domain'))
    
    await query`DELETE FROM sites WHERE domain = ${domain.toLowerCase()} AND type = ${type}`
    return c.json({ success: true, domain, type })
  } catch (error) {
    console.error('Error removing site:', error)
    return c.json({ success: false, error: 'Failed to remove site' }, 500)
  }
})

// ============================================
// Excluded URLs API
// ============================================

app.get('/excluded-urls', async (c) => {
  try {
    await ensureDbMigration()
    const urls = await query`SELECT * FROM excluded_urls ORDER BY created_at DESC`
    return c.json({ success: true, urls })
  } catch (error) {
    console.error('Error loading excluded urls:', error)
    return c.json({ success: false, error: 'Failed to load excluded urls' }, 500)
  }
})

app.post('/excluded-urls', async (c) => {
  try {
    await ensureDbMigration()
    const { url } = await c.req.json()
    if (!url) {
      return c.json({ success: false, error: 'Missing url' }, 400)
    }
    
    // URL 유효성 검사
    try {
      new URL(url)
    } catch {
      return c.json({ success: false, error: 'Invalid URL format' }, 400)
    }
    
    const result = await query`
      INSERT INTO excluded_urls (url) VALUES (${url}) 
      ON CONFLICT (url) DO NOTHING 
      RETURNING *
    `
    
    if (result.length === 0) {
      return c.json({ success: false, error: 'URL already exists' }, 409)
    }
    
    return c.json({ success: true, url: result[0] })
  } catch (error) {
    console.error('Error adding excluded url:', error)
    return c.json({ success: false, error: 'Failed to add excluded url' }, 500)
  }
})

app.delete('/excluded-urls/:id', async (c) => {
  try {
    await ensureDbMigration()
    const id = parseInt(c.req.param('id'))
    
    await query`DELETE FROM excluded_urls WHERE id = ${id}`
    return c.json({ success: true })
  } catch (error) {
    console.error('Error removing excluded url:', error)
    return c.json({ success: false, error: 'Failed to remove excluded url' }, 500)
  }
})

// ============================================
// Titles API
// ============================================

app.get('/titles', async (c) => {
  try {
    await ensureDbMigration()
    const current = await query`SELECT name, manta_url FROM titles WHERE is_current = true ORDER BY created_at DESC`
    const history = await query`SELECT name, manta_url FROM titles WHERE is_current = false ORDER BY created_at DESC`
    return c.json({ success: true, current, history })
  } catch (error) {
    console.error('Error loading titles:', error)
    return c.json({ success: false, error: 'Failed to load titles' }, 500)
  }
})

app.post('/titles', async (c) => {
  try {
    await ensureDbMigration()
    const { title, manta_url } = await c.req.json()
    if (!title) {
      return c.json({ success: false, error: 'Missing title' }, 400)
    }
    
    await query`
      INSERT INTO titles (name, is_current, manta_url) VALUES (${title}, true, ${manta_url || null})
      ON CONFLICT (name) DO UPDATE SET is_current = true, manta_url = COALESCE(${manta_url}, titles.manta_url)
    `
    return c.json({ success: true, title })
  } catch (error) {
    console.error('Error adding title:', error)
    return c.json({ success: false, error: 'Failed to add title' }, 500)
  }
})

app.delete('/titles/:title', async (c) => {
  try {
    await ensureDbMigration()
    const title = decodeURIComponent(c.req.param('title'))
    await query`UPDATE titles SET is_current = false WHERE name = ${title}`
    return c.json({ success: true, title })
  } catch (error) {
    console.error('Error removing title:', error)
    return c.json({ success: false, error: 'Failed to remove title' }, 500)
  }
})

app.post('/titles/restore', async (c) => {
  try {
    await ensureDbMigration()
    const { title } = await c.req.json()
    if (!title) {
      return c.json({ success: false, error: 'Missing title' }, 400)
    }
    
    await query`UPDATE titles SET is_current = true WHERE name = ${title}`
    return c.json({ success: true, title })
  } catch (error) {
    console.error('Error restoring title:', error)
    return c.json({ success: false, error: 'Failed to restore title' }, 500)
  }
})

// ============================================
// Sessions API
// ============================================

app.get('/sessions', async (c) => {
  try {
    await ensureDbMigration()
    const page = parseInt(c.req.query('page') || '1')
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20'), 1), 100)
    const offset = (page - 1) * limit
    
    const countResult = await query`SELECT COUNT(*) as count FROM sessions`
    const total = parseInt(countResult[0]?.count || '0')
    
    const sessions = await query`
      SELECT id, created_at, completed_at, status, 
             titles_count, keywords_count, total_searches,
             results_total, results_illegal, results_legal, results_pending
      FROM sessions 
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
    
    // 결과 요약 형식으로 변환
    const formattedSessions = sessions.map((s: any) => ({
      id: s.id,
      created_at: s.created_at,
      completed_at: s.completed_at,
      status: s.status,
      titles_count: s.titles_count,
      keywords_count: s.keywords_count,
      total_searches: s.total_searches,
      results_summary: {
        total: s.results_total || 0,
        illegal: s.results_illegal || 0,
        legal: s.results_legal || 0,
        pending: s.results_pending || 0
      }
    }))
    
    return c.json({
      success: true,
      count: total,
      sessions: formattedSessions,
      items: formattedSessions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    console.error('Error loading sessions:', error)
    return c.json({ success: false, error: 'Failed to load sessions' }, 500)
  }
})

app.get('/sessions/:id', async (c) => {
  try {
    await ensureDbMigration()
    const id = c.req.param('id')
    const sessions = await query`SELECT * FROM sessions WHERE id = ${id}`
    
    if (sessions.length === 0) {
      return c.json({ success: false, error: 'Session not found' }, 404)
    }
    
    const session = sessions[0]
    return c.json({
      success: true,
      session: {
        id: session.id,
        created_at: session.created_at,
        completed_at: session.completed_at,
        status: session.status,
        titles_count: session.titles_count,
        keywords_count: session.keywords_count,
        total_searches: session.total_searches,
        results_summary: {
          total: session.results_total || 0,
          illegal: session.results_illegal || 0,
          legal: session.results_legal || 0,
          pending: session.results_pending || 0
        },
        file_final_results: session.file_final_results
      }
    })
  } catch (error) {
    console.error('Error loading session:', error)
    return c.json({ success: false, error: 'Failed to load session' }, 500)
  }
})

app.get('/sessions/:id/results', async (c) => {
  try {
    await ensureDbMigration()
    const id = c.req.param('id')
    const page = parseInt(c.req.query('page') || '1')
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50'), 1), 100)
    const status = c.req.query('status')
    const title = c.req.query('title')
    const offset = (page - 1) * limit
    
    // 세션 존재 확인
    const sessions = await query`SELECT * FROM sessions WHERE id = ${id}`
    if (sessions.length === 0) {
      return c.json({ success: false, error: 'Session not found' }, 404)
    }
    
    const session = sessions[0]
    
    // detection_results 테이블에서 조회 시도
    try {
      let countQuery = `SELECT COUNT(*) as count FROM detection_results WHERE session_id = $1`
      let dataQuery = `SELECT * FROM detection_results WHERE session_id = $1`
      const params: any[] = [id]
      let paramIndex = 2
      
      if (status && status !== 'all') {
        countQuery += ` AND final_status = $${paramIndex}`
        dataQuery += ` AND final_status = $${paramIndex}`
        params.push(status)
        paramIndex++
      }
      
      if (title && title !== 'all') {
        countQuery += ` AND title = $${paramIndex}`
        dataQuery += ` AND title = $${paramIndex}`
        params.push(title)
        paramIndex++
      }
      
      dataQuery += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`
      params.push(limit, offset)
      
      const db = getDatabase()
      const countResult = await db(countQuery, params.slice(0, paramIndex - 1))
      const total = parseInt(countResult[0]?.count || '0')
      
      if (total > 0) {
        const results = await db(dataQuery, params)
        
        // 사용 가능한 타이틀 목록
        const titlesResult = await db`
          SELECT DISTINCT title FROM detection_results 
          WHERE session_id = ${id} AND title IS NOT NULL
          ORDER BY title
        `
        const available_titles = titlesResult.map((t: any) => t.title)
        
        return c.json({
          success: true,
          source: 'detection_results',
          results,
          items: results,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
          },
          available_titles
        })
      }
    } catch (dbError) {
      console.log('detection_results query failed, falling back to blob:', dbError)
    }
    
    // Blob에서 결과 로드 (fallback)
    if (!session.file_final_results) {
      return c.json({
        success: true,
        source: 'empty',
        results: [],
        items: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
        available_titles: []
      })
    }
    
    try {
      const response = await fetch(session.file_final_results)
      if (!response.ok) {
        throw new Error('Failed to fetch blob')
      }
      
      let results = await response.json()
      
      // URL 기준 중복 제거
      const seen = new Set()
      results = results.filter((r: any) => {
        if (seen.has(r.url)) return false
        seen.add(r.url)
        return true
      })
      
      // 필터링
      if (status && status !== 'all') {
        results = results.filter((r: any) => r.final_status === status)
      }
      if (title && title !== 'all') {
        results = results.filter((r: any) => r.title === title)
      }
      
      const total = results.length
      const paginatedResults = results.slice(offset, offset + limit)
      
      // 사용 가능한 타이틀 목록
      const available_titles = [...new Set(results.map((r: any) => r.title).filter(Boolean))].sort()
      
      return c.json({
        success: true,
        source: 'blob',
        results: paginatedResults,
        items: paginatedResults,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        },
        available_titles
      })
    } catch (blobError) {
      console.error('Blob fetch error:', blobError)
      return c.json({
        success: true,
        source: 'error',
        results: [],
        items: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
        available_titles: [],
        error: 'Failed to load results'
      })
    }
  } catch (error) {
    console.error('Error loading session results:', error)
    return c.json({ success: false, error: 'Failed to load session results' }, 500)
  }
})

app.get('/sessions/:id/download', async (c) => {
  try {
    await ensureDbMigration()
    const id = c.req.param('id')
    
    const sessions = await query`SELECT * FROM sessions WHERE id = ${id}`
    if (sessions.length === 0) {
      return c.json({ success: false, error: 'Session not found' }, 404)
    }
    
    const session = sessions[0]
    if (!session.file_final_results) {
      return c.json({ success: false, error: 'No results file available' }, 404)
    }
    
    // Blob에서 결과 로드
    const response = await fetch(session.file_final_results)
    if (!response.ok) {
      return c.json({ success: false, error: 'Failed to fetch results' }, 500)
    }
    
    const results = await response.json()
    
    // Excel 생성
    const workbook = XLSX.utils.book_new()
    
    // 전체 결과 시트
    const allData = results.map((r: any) => ({
      '작품명': r.title || '',
      '검색어': r.search_query || '',
      '페이지': r.page || 0,
      '순위': r.rank || 0,
      '제목': r.page_title || '',
      '도메인': r.domain || '',
      'URL': r.url || '',
      '상태': r.final_status || '',
      'LLM 판단': r.llm_judgment || '',
      'LLM 사유': r.llm_reason || ''
    }))
    
    const allSheet = XLSX.utils.json_to_sheet(allData)
    XLSX.utils.book_append_sheet(workbook, allSheet, '전체 결과')
    
    // 불법 사이트 시트
    const illegalData = results
      .filter((r: any) => r.final_status === 'illegal')
      .map((r: any) => ({
        '작품명': r.title || '',
        '도메인': r.domain || '',
        'URL': r.url || '',
        '검색어': r.search_query || ''
      }))
    
    if (illegalData.length > 0) {
      const illegalSheet = XLSX.utils.json_to_sheet(illegalData)
      XLSX.utils.book_append_sheet(workbook, illegalSheet, '불법 사이트')
    }
    
    // Excel 파일 생성
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="jobdori-results-${id}.xlsx"`
      }
    })
  } catch (error) {
    console.error('Error downloading session:', error)
    return c.json({ success: false, error: 'Failed to download session' }, 500)
  }
})

// ============================================
// Dashboard API
// ============================================

app.get('/dashboard/months', async (c) => {
  try {
    await ensureDbMigration()
    const stats = await query`SELECT DISTINCT month FROM monthly_stats ORDER BY month DESC`
    const months = stats.map((s: any) => s.month)
    const currentMonth = new Date().toISOString().slice(0, 7)
    
    return c.json({
      success: true,
      months,
      current_month: currentMonth
    })
  } catch (error) {
    console.error('Error loading months:', error)
    return c.json({ success: false, error: 'Failed to load months' }, 500)
  }
})

app.get('/dashboard', async (c) => {
  try {
    await ensureDbMigration()
    const month = c.req.query('month')
    const currentMonth = new Date().toISOString().slice(0, 7)
    
    let stats: any
    
    if (month) {
      const result = await query`SELECT * FROM monthly_stats WHERE month = ${month}`
      stats = result[0]
    } else {
      const result = await query`SELECT * FROM monthly_stats ORDER BY month DESC LIMIT 1`
      stats = result[0]
    }
    
    if (!stats) {
      return c.json({
        success: true,
        month: month || currentMonth,
        sessions_count: 0,
        top_contents: [],
        top_illegal_sites: [],
        total_stats: { total: 0, illegal: 0, legal: 0, pending: 0 }
      })
    }
    
    // top_contents와 top_illegal_sites 파싱
    let topContents = stats.top_contents
    let topIllegalSites = stats.top_illegal_sites
    
    if (typeof topContents === 'string') {
      try { topContents = JSON.parse(topContents) } catch { topContents = [] }
    }
    if (typeof topIllegalSites === 'string') {
      try { topIllegalSites = JSON.parse(topIllegalSites) } catch { topIllegalSites = [] }
    }
    
    return c.json({
      success: true,
      month: stats.month,
      sessions_count: stats.sessions_count || 0,
      top_contents: topContents || [],
      top_illegal_sites: topIllegalSites || [],
      total_stats: {
        total: stats.total || 0,
        illegal: stats.illegal || 0,
        legal: stats.legal || 0,
        pending: stats.pending || 0
      }
    })
  } catch (error) {
    console.error('Error loading dashboard:', error)
    return c.json({ success: false, error: 'Failed to load dashboard' }, 500)
  }
})

app.get('/dashboard/all-titles', async (c) => {
  try {
    await ensureDbMigration()
    const month = c.req.query('month')
    
    // monthly_stats에서 해당 월의 데이터 가져오기
    let stats: any
    if (month) {
      const result = await query`SELECT * FROM monthly_stats WHERE month = ${month}`
      stats = result[0]
    } else {
      const result = await query`SELECT * FROM monthly_stats ORDER BY month DESC LIMIT 1`
      stats = result[0]
    }
    
    if (!stats) {
      return c.json({ success: true, titles: [] })
    }
    
    // top_contents 파싱
    let topContents = stats.top_contents
    if (typeof topContents === 'string') {
      try { topContents = JSON.parse(topContents) } catch { topContents = [] }
    }
    
    return c.json({
      success: true,
      titles: topContents || []
    })
  } catch (error) {
    console.error('Error loading all titles:', error)
    return c.json({ success: false, error: 'Failed to load all titles' }, 500)
  }
})

// ============================================
// Stats API
// ============================================

app.get('/stats', async (c) => {
  try {
    await ensureDbMigration()
    
    const pendingResult = await query`SELECT COUNT(*) as count FROM pending_reviews`
    const illegalResult = await query`SELECT COUNT(*) as count FROM sites WHERE type = 'illegal'`
    const legalResult = await query`SELECT COUNT(*) as count FROM sites WHERE type = 'legal'`
    
    return c.json({
      success: true,
      pending_count: parseInt(pendingResult[0]?.count || '0'),
      illegal_sites_count: parseInt(illegalResult[0]?.count || '0'),
      legal_sites_count: parseInt(legalResult[0]?.count || '0')
    })
  } catch (error) {
    console.error('Error loading stats:', error)
    return c.json({ success: false, error: 'Failed to load stats' }, 500)
  }
})

// ============================================
// Manta Rankings API
// ============================================

app.get('/manta-rankings', async (c) => {
  try {
    await ensureDbMigration()
    
    const rankings = await query`
      SELECT title, manta_rank, first_rank_domain, search_query, page1_illegal_count
      FROM manta_rankings 
      ORDER BY 
        CASE WHEN manta_rank IS NULL THEN 1 ELSE 0 END,
        manta_rank ASC
    `
    
    return c.json({
      success: true,
      rankings: rankings.map((r: any) => ({
        title: r.title,
        mantaRank: r.manta_rank,
        firstRankDomain: r.first_rank_domain,
        searchQuery: r.search_query,
        page1IllegalCount: r.page1_illegal_count || 0
      }))
    })
  } catch (error) {
    console.error('Error loading manta rankings:', error)
    return c.json({ success: false, error: 'Failed to load manta rankings' }, 500)
  }
})

app.get('/titles/:title/ranking-history', async (c) => {
  try {
    await ensureDbMigration()
    const title = decodeURIComponent(c.req.param('title'))
    
    const history = await query`
      SELECT manta_rank as rank, first_rank_domain, session_id, recorded_at
      FROM manta_ranking_history
      WHERE title = ${title}
      ORDER BY recorded_at DESC
      LIMIT 30
    `
    
    return c.json({
      success: true,
      history: history.map((h: any) => ({
        rank: h.rank,
        firstRankDomain: h.first_rank_domain,
        sessionId: h.session_id,
        recordedAt: h.recorded_at
      }))
    })
  } catch (error) {
    console.error('Error loading ranking history:', error)
    return c.json({ success: false, error: 'Failed to load ranking history' }, 500)
  }
})

// ============================================
// Title List API
// ============================================

app.get('/titles/list', async (c) => {
  try {
    await ensureDbMigration()
    const titles = await query`SELECT name FROM titles WHERE is_current = true ORDER BY name`
    return c.json({
      success: true,
      titles: titles.map((t: any) => t.name)
    })
  } catch (error) {
    console.error('Error loading titles list:', error)
    return c.json({ success: false, error: 'Failed to load titles list' }, 500)
  }
})

// ============================================
// Stats by Title API
// ============================================

app.get('/stats/by-title', async (c) => {
  try {
    await ensureDbMigration()
    const startDate = c.req.query('start')
    const endDate = c.req.query('end')
    
    // 기본값: 최근 30일
    const defaultEnd = new Date()
    const defaultStart = new Date(defaultEnd.getTime() - 30 * 24 * 60 * 60 * 1000)
    
    const start = startDate || defaultStart.toISOString().split('T')[0]
    const end = endDate || defaultEnd.toISOString().split('T')[0]
    
    // 세션별 탐지/신고/차단 통계
    const stats = await query`
      WITH session_stats AS (
        SELECT 
          s.id as session_id,
          s.created_at,
          (SELECT COUNT(*) FROM report_tracking rt WHERE rt.session_id = s.id) as detected,
          (SELECT COUNT(*) FROM report_tracking rt WHERE rt.session_id = s.id AND rt.report_status IN ('신고완료', 'reported')) as reported,
          (SELECT COUNT(*) FROM report_tracking rt WHERE rt.session_id = s.id AND rt.report_status IN ('차단확인', 'blocked')) as blocked
        FROM sessions s
        WHERE s.created_at >= ${start}::date AND s.created_at < (${end}::date + INTERVAL '1 day')
          AND s.status = 'completed'
      )
      SELECT 
        COALESCE(SUM(detected), 0) as total_detected,
        COALESCE(SUM(reported), 0) as total_reported,
        COALESCE(SUM(blocked), 0) as total_blocked
      FROM session_stats
    `
    
    // 작품별 통계
    const titleStats = await query`
      SELECT 
        rt.title,
        COUNT(*) as detected,
        COUNT(*) FILTER (WHERE rt.report_status IN ('신고완료', 'reported')) as reported,
        COUNT(*) FILTER (WHERE rt.report_status IN ('차단확인', 'blocked')) as blocked
      FROM report_tracking rt
      JOIN sessions s ON rt.session_id = s.id
      WHERE s.created_at >= ${start}::date 
        AND s.created_at < (${end}::date + INTERVAL '1 day')
        AND s.status = 'completed'
        AND rt.title IS NOT NULL
      GROUP BY rt.title
      ORDER BY detected DESC
    `
    
    return c.json({
      success: true,
      period: { start, end },
      summary: {
        detected: parseInt(stats[0]?.total_detected || '0'),
        reported: parseInt(stats[0]?.total_reported || '0'),
        blocked: parseInt(stats[0]?.total_blocked || '0')
      },
      by_title: titleStats.map((t: any) => ({
        title: t.title,
        detected: parseInt(t.detected),
        reported: parseInt(t.reported),
        blocked: parseInt(t.blocked),
        blockRate: t.reported > 0 
          ? `${Math.round((parseInt(t.blocked) / parseInt(t.reported)) * 100)}%`
          : '0%'
      }))
    })
  } catch (error) {
    console.error('Error loading stats by title:', error)
    return c.json({ success: false, error: 'Failed to load stats by title' }, 500)
  }
})

// ============================================
// Report Tracking API
// ============================================

app.get('/report-tracking/sessions', async (c) => {
  try {
    await ensureDbMigration()
    
    const sessions = await query`
      SELECT 
        s.id,
        s.created_at,
        (SELECT COUNT(*) FROM report_tracking rt WHERE rt.session_id = s.id) as total_count,
        (SELECT COUNT(*) FROM report_tracking rt WHERE rt.session_id = s.id AND rt.report_status IN ('신고완료', 'reported')) as reported_count,
        (SELECT COUNT(*) FROM report_tracking rt WHERE rt.session_id = s.id AND rt.report_status IN ('차단확인', 'blocked')) as blocked_count,
        (SELECT COUNT(*) FROM report_tracking rt WHERE rt.session_id = s.id AND rt.report_status IN ('미신고', 'pending')) as pending_count
      FROM sessions s
      WHERE s.status = 'completed'
      ORDER BY s.created_at DESC
      LIMIT 50
    `
    
    return c.json({
      success: true,
      sessions: sessions.map((s: any) => ({
        id: s.id,
        created_at: s.created_at,
        total_count: parseInt(s.total_count),
        reported_count: parseInt(s.reported_count),
        blocked_count: parseInt(s.blocked_count),
        pending_count: parseInt(s.pending_count)
      }))
    })
  } catch (error) {
    console.error('Error loading report tracking sessions:', error)
    return c.json({ success: false, error: 'Failed to load sessions' }, 500)
  }
})

app.get('/report-tracking/reasons', async (c) => {
  try {
    await ensureDbMigration()
    const reasons = await query`SELECT reason_text FROM report_reasons ORDER BY usage_count DESC`
    return c.json({
      success: true,
      reasons: reasons.map((r: any) => r.reason_text)
    })
  } catch (error) {
    console.error('Error loading report reasons:', error)
    return c.json({ success: false, error: 'Failed to load reasons' }, 500)
  }
})

app.get('/report-tracking/:sessionId', async (c) => {
  try {
    await ensureDbMigration()
    const sessionId = c.req.param('sessionId')
    const page = parseInt(c.req.query('page') || '1')
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50'), 1), 100)
    const status = c.req.query('status')
    const title = c.req.query('title')
    const offset = (page - 1) * limit
    
    let countQuery = `SELECT COUNT(*) as count FROM report_tracking WHERE session_id = $1`
    let dataQuery = `SELECT * FROM report_tracking WHERE session_id = $1`
    const params: any[] = [sessionId]
    let paramIndex = 2
    
    if (status && status !== 'all') {
      countQuery += ` AND report_status = $${paramIndex}`
      dataQuery += ` AND report_status = $${paramIndex}`
      params.push(status)
      paramIndex++
    }
    
    if (title && title !== 'all') {
      countQuery += ` AND title = $${paramIndex}`
      dataQuery += ` AND title = $${paramIndex}`
      params.push(title)
      paramIndex++
    }
    
    dataQuery += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`
    params.push(limit, offset)
    
    const db = getDatabase()
    const countResult = await db(countQuery, params.slice(0, paramIndex - 1))
    const total = parseInt(countResult[0]?.count || '0')
    
    const items = await db(dataQuery, params)
    
    // 사용 가능한 타이틀 목록
    const titlesResult = await db`
      SELECT DISTINCT title FROM report_tracking 
      WHERE session_id = ${sessionId} AND title IS NOT NULL
      ORDER BY title
    `
    const available_titles = titlesResult.map((t: any) => t.title)
    
    return c.json({
      success: true,
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      available_titles
    })
  } catch (error) {
    console.error('Error loading report tracking data:', error)
    return c.json({ success: false, error: 'Failed to load data' }, 500)
  }
})

app.get('/report-tracking/:sessionId/stats', async (c) => {
  try {
    await ensureDbMigration()
    const sessionId = c.req.param('sessionId')
    
    const stats = await query`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE report_status IN ('신고완료', 'reported')) as reported,
        COUNT(*) FILTER (WHERE report_status IN ('차단확인', 'blocked')) as blocked,
        COUNT(*) FILTER (WHERE report_status IN ('미신고', 'pending')) as pending,
        COUNT(*) FILTER (WHERE report_status IN ('제외', 'rejected')) as rejected
      FROM report_tracking
      WHERE session_id = ${sessionId}
    `
    
    return c.json({
      success: true,
      stats: {
        total: parseInt(stats[0]?.total || '0'),
        reported: parseInt(stats[0]?.reported || '0'),
        blocked: parseInt(stats[0]?.blocked || '0'),
        pending: parseInt(stats[0]?.pending || '0'),
        rejected: parseInt(stats[0]?.rejected || '0')
      }
    })
  } catch (error) {
    console.error('Error loading report tracking stats:', error)
    return c.json({ success: false, error: 'Failed to load stats' }, 500)
  }
})

app.put('/report-tracking/:id/status', async (c) => {
  try {
    await ensureDbMigration()
    const id = parseInt(c.req.param('id'))
    const { status } = await c.req.json()
    
    await query`UPDATE report_tracking SET report_status = ${status}, updated_at = NOW() WHERE id = ${id}`
    return c.json({ success: true })
  } catch (error) {
    console.error('Error updating report status:', error)
    return c.json({ success: false, error: 'Failed to update status' }, 500)
  }
})

app.put('/report-tracking/:id/reason', async (c) => {
  try {
    await ensureDbMigration()
    const id = parseInt(c.req.param('id'))
    const { reason } = await c.req.json()
    
    await query`UPDATE report_tracking SET reason = ${reason}, updated_at = NOW() WHERE id = ${id}`
    
    // 신고 사유 저장
    if (reason) {
      await query`
        INSERT INTO report_reasons (reason_text, usage_count) VALUES (${reason}, 1)
        ON CONFLICT (reason_text) DO UPDATE SET usage_count = report_reasons.usage_count + 1
      `
    }
    
    return c.json({ success: true })
  } catch (error) {
    console.error('Error updating report reason:', error)
    return c.json({ success: false, error: 'Failed to update reason' }, 500)
  }
})

app.put('/report-tracking/:id/report-id', async (c) => {
  try {
    await ensureDbMigration()
    const id = parseInt(c.req.param('id'))
    const { report_id } = await c.req.json()
    
    await query`UPDATE report_tracking SET report_id = ${report_id}, updated_at = NOW() WHERE id = ${id}`
    return c.json({ success: true })
  } catch (error) {
    console.error('Error updating report id:', error)
    return c.json({ success: false, error: 'Failed to update report id' }, 500)
  }
})

app.post('/report-tracking/:sessionId/add-url', async (c) => {
  try {
    await ensureDbMigration()
    const sessionId = c.req.param('sessionId')
    const { url, title } = await c.req.json()
    
    if (!url) {
      return c.json({ success: false, error: 'Missing url' }, 400)
    }
    
    // URL에서 도메인 추출
    let domain = ''
    try {
      domain = new URL(url).hostname.replace('www.', '')
    } catch {
      return c.json({ success: false, error: 'Invalid URL' }, 400)
    }
    
    await query`
      INSERT INTO report_tracking (session_id, url, domain, title, report_status)
      VALUES (${sessionId}, ${url}, ${domain}, ${title || null}, '미신고')
      ON CONFLICT (session_id, url) DO NOTHING
    `
    
    return c.json({ success: true })
  } catch (error) {
    console.error('Error adding URL:', error)
    return c.json({ success: false, error: 'Failed to add URL' }, 500)
  }
})

app.get('/report-tracking/:sessionId/urls', async (c) => {
  try {
    await ensureDbMigration()
    const sessionId = c.req.param('sessionId')
    const status = c.req.query('status')
    
    let urls: any[]
    if (status) {
      urls = await query`
        SELECT url FROM report_tracking 
        WHERE session_id = ${sessionId} AND report_status = ${status}
        ORDER BY created_at DESC
      `
    } else {
      urls = await query`
        SELECT url FROM report_tracking 
        WHERE session_id = ${sessionId}
        ORDER BY created_at DESC
      `
    }
    
    return c.json({
      success: true,
      urls: urls.map((u: any) => u.url)
    })
  } catch (error) {
    console.error('Error loading URLs:', error)
    return c.json({ success: false, error: 'Failed to load URLs' }, 500)
  }
})

app.get('/report-tracking/:sessionId/export', async (c) => {
  try {
    await ensureDbMigration()
    const sessionId = c.req.param('sessionId')
    
    const items = await query`
      SELECT * FROM report_tracking 
      WHERE session_id = ${sessionId}
      ORDER BY created_at DESC
    `
    
    // CSV 생성
    const headers = ['작품명', '도메인', 'URL', '검색어', '페이지', '순위', '신고상태', '신고사유', '신고ID', '생성일', '수정일']
    const rows = items.map((item: any) => [
      item.title || '',
      item.domain || '',
      item.url || '',
      item.search_query || '',
      item.page || '',
      item.rank || '',
      item.report_status || '',
      item.reason || '',
      item.report_id || '',
      item.created_at || '',
      item.updated_at || ''
    ])
    
    const csvContent = [headers, ...rows]
      .map(row => row.map((cell: any) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    
    // UTF-8 BOM 추가
    const bom = '\uFEFF'
    
    return new Response(bom + csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="report-tracking-${sessionId}.csv"`
      }
    })
  } catch (error) {
    console.error('CSV export error:', error)
    return c.json({ success: false, error: 'Failed to export CSV' }, 500)
  }
})

// ============================================
// Export for Next.js App Router
// ============================================

export const GET = handle(app)
export const POST = handle(app)
export const PUT = handle(app)
export const DELETE = handle(app)
export const PATCH = handle(app)
