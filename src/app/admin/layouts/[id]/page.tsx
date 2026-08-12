import { Editor } from '@/editor/Editor';

export default async function AdminLayoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Editor layoutId={id} />;
}
