import { Editor } from '@/editor/Editor';

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Editor deckId={id} />;
}
