export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <div className="leading-none">
        <div className="flex items-end gap-1">
          <span className="text-2xl font-extrabold tracking-tight text-foreground">CSC</span>
          <Flame />
        </div>
        {!compact && (
          <div className="mt-2">
            <p className="text-sm font-semibold text-foreground">Chandrabhan Sharma College</p>
            <p className="text-xs font-medium text-primary">Arts, Commerce &amp; Science</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Flame() {
  return (
    <svg width="22" height="26" viewBox="0 0 24 28" fill="none" aria-hidden="true">
      <path
        d="M13.5 1c1.2 4.2.3 6.6-1.8 9.2-2 2.5-4.7 4.6-4.7 8.4A7 7 0 0 0 14 25.6c4-.6 6.6-3.9 6.6-8 0-3-1.2-5.2-2.6-7.2.2 1.9-.4 3.2-1.4 4-.1-4.6-1.4-9.4-3.1-13.4Z"
        fill="currentColor"
        className="text-primary"
      />
      <path
        d="M6.4 6.2c.5 2.4-.2 3.7-1.3 5.2-1 1.4-2.4 2.7-2.4 4.8 0 2.3 1.5 4 3.6 4.4-1-1.6-1-3.3-.2-4.9.9-1.8 1.4-3.4.3-9.5Z"
        fill="currentColor"
        className="text-primary/60"
      />
    </svg>
  );
}
