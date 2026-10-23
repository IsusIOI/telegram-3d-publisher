import { getStore } from '@netlify/blobs';
export default async (req) => {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^[a-f0-9]{12}$/.test(id)) return new Response('Invalid preview id', { status: 400 });
  const store = getStore('krutilka-models');
  const blob = await store.get(`previews/${id}`, { type: 'arrayBuffer' });
  if (!blob) return new Response('Preview not found', { status: 404 });
  const meta = await store.getMetadata(`previews/${id}`);
  return new Response(blob, { headers: { 'content-type': meta?.metadata?.contentType || 'image/jpeg', 'cache-control': 'public, max-age=3600' } });
};
