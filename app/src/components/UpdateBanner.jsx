export default function UpdateBanner() {
  return (
    <div
      className="fixed bottom-5 right-5 z-50 flex items-center gap-4 bg-tm-navy border border-tm-teal/40 text-white rounded-xl shadow-2xl px-5 py-4"
      style={{ animation: 'slideUp 0.35s ease-out' }}
    >
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Icon */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-tm-teal/20 flex items-center justify-center">
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-tm-teal">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.25a.75.75 0 00-1.5 0v4.59L7.3 9.24a.75.75 0 00-1.1 1.02l3.25 3.5a.75.75 0 001.1 0l3.25-3.5a.75.75 0 10-1.1-1.02l-1.95 2.1V6.75z" clipRule="evenodd" />
        </svg>
      </div>

      <div>
        <p className="font-brand font-bold text-sm leading-tight">Update Available</p>
        <p className="text-tm-teal text-xs mt-0.5">A new version has been deployed.</p>
      </div>

      <button
        onClick={() => window.location.reload()}
        className="ml-2 bg-tm-teal text-tm-navy font-brand font-bold text-xs px-4 py-2 rounded-lg hover:brightness-110 active:scale-95 transition-all whitespace-nowrap"
      >
        Update Now
      </button>
    </div>
  )
}
