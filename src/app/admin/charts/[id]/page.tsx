import { ChartTemplateEditor } from '@/admin/ChartTemplateEditor';

export default async function ChartTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChartTemplateEditor id={id} />;
}
