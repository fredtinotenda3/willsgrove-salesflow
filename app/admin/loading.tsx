import { LoadingBlock } from "./_components/ui";

/** Skeleton shown while an admin page's server queries run. */
export default function AdminLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <div className="h-8 w-56 animate-pulse rounded-md bg-[#E8EDE6]" />
      <div className="h-4 w-96 max-w-full animate-pulse rounded bg-[#EEF1ED]" />
      <LoadingBlock rows={8} />
    </div>
  );
}
