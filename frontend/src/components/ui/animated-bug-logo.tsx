"use client";

import { useId } from "react";

export function AnimatedBugLogo() {
  const uid = useId().replace(/:/g, "");
  const gradId = `abg-${uid}`;

  return (
    <div className="relative shrink-0 w-9 h-9" style={{ overflow: "visible" }}>
      {/* Static: orange square background only (no bug) */}
      <svg width="36" height="36" viewBox="0 0 200 200" className="rounded-xl ring-2 ring-white/40 block">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="200" y2="200" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#fb923c" />
            <stop offset="100%" stopColor="#ea580c" />
          </linearGradient>
        </defs>
        <rect width="200" height="200" rx="46" fill={`url(#${gradId})`} />
        <rect x="10" y="10" width="180" height="90" rx="36" fill="white" opacity="0.06" />
      </svg>

      {/* Animated bug — flies out and returns to logo */}
      <svg
        width="36" height="36"
        viewBox="0 0 200 200"
        className="absolute top-0 left-0 tf-bug-fly"
        style={{ overflow: "visible", filter: "drop-shadow(0 3px 8px rgba(0,0,0,0.22))", zIndex: 10 }}
        aria-hidden="true"
      >
        {/* Head */}
        <circle cx="100" cy="76" r="28" fill="white" />
        {/* Eyes */}
        <circle cx="89" cy="73" r="6" fill="#ea580c" />
        <circle cx="111" cy="73" r="6" fill="#ea580c" />
        {/* Eye shine */}
        <circle cx="91" cy="71" r="2" fill="white" opacity="0.6" />
        <circle cx="113" cy="71" r="2" fill="white" opacity="0.6" />
        {/* Body */}
        <rect x="67" y="96" width="66" height="80" rx="33" fill="white" />
        {/* Body segment */}
        <line x1="70" y1="132" x2="130" y2="132" stroke="#f97316" strokeWidth="3" strokeLinecap="round" opacity="0.35" />
        {/* Left antenna */}
        <line x1="88" y1="51" x2="70" y2="32" stroke="white" strokeWidth="6" strokeLinecap="round" />
        <circle cx="68" cy="30" r="5.5" fill="white" />
        {/* Right antenna */}
        <line x1="112" y1="51" x2="130" y2="32" stroke="white" strokeWidth="6" strokeLinecap="round" />
        <circle cx="132" cy="30" r="5.5" fill="white" />
        {/* Left legs */}
        <line x1="67" y1="110" x2="42" y2="99" stroke="white" strokeWidth="5.5" strokeLinecap="round" />
        <line x1="67" y1="132" x2="40" y2="132" stroke="white" strokeWidth="5.5" strokeLinecap="round" />
        <line x1="67" y1="154" x2="42" y2="165" stroke="white" strokeWidth="5.5" strokeLinecap="round" />
        {/* Right legs */}
        <line x1="133" y1="110" x2="158" y2="99" stroke="white" strokeWidth="5.5" strokeLinecap="round" />
        <line x1="133" y1="132" x2="160" y2="132" stroke="white" strokeWidth="5.5" strokeLinecap="round" />
        <line x1="133" y1="154" x2="158" y2="165" stroke="white" strokeWidth="5.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}
