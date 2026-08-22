export function Logo({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <>
        <img
          src="/csc-logo.png"
          alt="CSC"
          className="h-8 w-auto object-contain dark:hidden"
          draggable={false}
        />
        <img
          src="/csc-logo-white.png"
          alt="CSC"
          className="h-8 w-auto object-contain hidden dark:block"
          draggable={false}
        />
      </>
    );
  }

  return (
    <>
      <img
        src="/csc-logo.png"
        alt="Chandrabhan Sharma College — Arts, Commerce & Science"
        className="h-24 w-auto object-contain object-left dark:hidden"
        draggable={false}
      />
      <img
        src="/csc-logo-white.png"
        alt="Chandrabhan Sharma College — Arts, Commerce & Science"
        className="h-24 w-auto object-contain object-left hidden dark:block"
        draggable={false}
      />
    </>
  );
}
