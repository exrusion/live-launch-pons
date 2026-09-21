import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" className="logo" aria-label="gamepad markets home">
      <span className="logo-mark" aria-hidden="true">
        <img src="/gamepad-logo.png" alt="" />
      </span>
      <span>gamepad<em>.markets</em></span>
    </Link>
  );
}
