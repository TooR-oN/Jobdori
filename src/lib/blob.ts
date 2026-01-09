// ============================================
// Vercel Blob Storage Utilities
// ============================================

import { put, del, list, head } from '@vercel/blob'

// ============================================
// 타입 정의
// ============================================

export interface FinalResult {
  title: string
  domain: string
  url: string
  search_query: string
  page: number
  rank: number
  status: 'illegal' | 'legal' | 'unknown'
  llm_judgment: 'likely_illegal' | 'likely_legal' | 'uncertain' | null
  llm_reason: string | null
  final_status: 'illegal' | 'legal' | 'pending'
  reviewed_at: string | null
}

// ============================================
// Blob Operations
// ============================================

/**
 * JSON 결과 파일 업로드
 */
export async function uploadResults(sessionId: string, results: FinalResult[]): Promise<string> {
  const filename = `results/${sessionId}/final-results.json`
  
  const blob = await put(filename, JSON.stringify(results, null, 2), {
    access: 'public',
    contentType: 'application/json',
  })
  
  console.log(`📤 Uploaded: ${blob.url}`)
  return blob.url
}

/**
 * JSON 결과 파일 다운로드
 */
export async function downloadResults(blobUrl: string): Promise<FinalResult[]> {
  try {
    const response = await fetch(blobUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`)
    }
    const data = await response.json()
    return data as FinalResult[]
  } catch (error) {
    console.error('Failed to download results:', error)
    return []
  }
}

/**
 * 세션 ID로 결과 파일 URL 조회
 */
export async function getResultsUrl(sessionId: string): Promise<string | null> {
  try {
    const { blobs } = await list({
      prefix: `results/${sessionId}/`,
    })
    
    const resultBlob = blobs.find(b => b.pathname.includes('final-results.json'))
    return resultBlob?.url || null
  } catch (error) {
    console.error('Failed to get results URL:', error)
    return null
  }
}

/**
 * 결과 파일 삭제
 */
export async function deleteResults(sessionId: string): Promise<boolean> {
  try {
    const { blobs } = await list({
      prefix: `results/${sessionId}/`,
    })
    
    for (const blob of blobs) {
      await del(blob.url)
    }
    
    console.log(`🗑️ Deleted results for session: ${sessionId}`)
    return true
  } catch (error) {
    console.error('Failed to delete results:', error)
    return false
  }
}

/**
 * 모든 세션의 결과 파일 목록 조회
 */
export async function listAllResults(): Promise<{ sessionId: string, url: string, size: number }[]> {
  try {
    const { blobs } = await list({
      prefix: 'results/',
    })
    
    return blobs
      .filter(b => b.pathname.includes('final-results.json'))
      .map(b => {
        const parts = b.pathname.split('/')
        return {
          sessionId: parts[1] || '',
          url: b.url,
          size: b.size,
        }
      })
  } catch (error) {
    console.error('Failed to list results:', error)
    return []
  }
}

/**
 * Blob URL이 존재하는지 확인
 */
export async function checkBlobExists(blobUrl: string): Promise<boolean> {
  try {
    const metadata = await head(blobUrl)
    return !!metadata
  } catch (error) {
    return false
  }
}
