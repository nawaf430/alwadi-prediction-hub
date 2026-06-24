export function ScoringRules({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="rounded-2xl border border-gray-800 bg-[#111111] p-4 text-base text-gray-400 space-y-1.5">
        <p>🎯 نتيجة دقيقة = <span className="text-[#22c55e] font-bold">3 نقاط</span></p>
        <p>✅ الفائز صحيح = <span className="text-[#22c55e] font-bold">1 نقطة</span></p>
        <p>❌ خطأ = <span className="text-red-400 font-bold">0 نقاط</span></p>
        <p className="text-gray-500 text-sm pt-1 border-t border-gray-800">
          الترتيب عند التعادل: أكثر النتائج الدقيقة
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-gray-800 bg-[#111111] p-5 mb-4">
      <h2 className="text-white font-bold text-lg mb-3">📋 قواعد النقاط</h2>
      <ul className="space-y-2 text-base text-gray-300">
        <li>🎯 <span className="text-[#22c55e] font-bold">نتيجة دقيقة</span> = 3 نقاط</li>
        <li>✅ <span className="text-[#22c55e] font-bold">الفائز صحيح</span> = 1 نقطة</li>
        <li>❌ <span className="text-red-400 font-bold">توقع خاطئ</span> = 0 نقاط</li>
        <li className="text-gray-500 pt-2 border-t border-gray-800 text-sm">
          عند التعادل: الفائز من لديه أكثر نتائج دقيقة (3 نقاط)
        </li>
      </ul>
    </div>
  )
}
