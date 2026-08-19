import { AdminGate } from '@/admin/AdminGate';

/**
 * Everything under /admin — the Admin tab and the layout / chart-template
 * editors it opens — sits behind the password prompt.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminGate>{children}</AdminGate>;
}
