// ============================================
// 신고결과 추적 메인 페이지 컴포넌트
// ============================================

'use client'

import { useState } from 'react'
import { ReportTrackingList } from './report-tracking-list'
import { ReportTrackingDetail } from './report-tracking-detail'

export function ReportTrackingPage() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      {selectedSessionId ? (
        <ReportTrackingDetail
          sessionId={selectedSessionId}
          onBack={() => setSelectedSessionId(null)}
        />
      ) : (
        <ReportTrackingList onSelectSession={setSelectedSessionId} />
      )}
    </div>
  )
}
