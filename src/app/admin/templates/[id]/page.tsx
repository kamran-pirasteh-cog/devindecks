import { Editor } from '@/editor/Editor';

export default async function AdminTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Editor templateId={id} />;
}
