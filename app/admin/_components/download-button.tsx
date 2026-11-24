/** A GET form so the browser performs a normal file download (no client-side navigation to an API route). */
export function DownloadButton({ href, children, className = "rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm font-semibold" }: { href: string; children: React.ReactNode; className?: string }) {
  const [path, query = ""] = href.split("?");
  const params = [...new URLSearchParams(query).entries()];
  return (
    <form action={path} method="get">
      {params.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button type="submit" className={className}>{children}</button>
    </form>
  );
}
