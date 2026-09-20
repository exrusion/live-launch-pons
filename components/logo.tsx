import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" className="logo" aria-label="pons game studio home">
      <span className="logo-mark" aria-hidden="true"><i /><i /><i /></span>
      <span>pons <em>game studio</em></span>
    </Link>
  );
}
