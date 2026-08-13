import { Suspense } from 'react';
import { Home } from '@/home/Home';

// Home reads `?tab=…` via useSearchParams, which opts its subtree into
// client-side rendering — the boundary keeps that scoped to the dashboard.
export default function Page() {
  return (
    <Suspense>
      <Home />
    </Suspense>
  );
}
